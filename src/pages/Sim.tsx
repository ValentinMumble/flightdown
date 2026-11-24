import {lazy, Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {Maximize, Play, RotateCcw, Smartphone, Square, Volume2, VolumeX, ZoomIn} from 'lucide-react';
import {useStore} from '../data/store';
import {Segmented} from '../components/ui';
import {Panel} from '../components/instruments';
import {useSeriesColor} from '../components/colors';
import {heliParams} from '../sim/physics';
import {isLowered, movedAxis, SETUP_STEPS, type Mapping, type Stick} from '../sim/input';
import {FACINGS, HOVER_GOAL, type DrillKind, type Facing} from '../sim/drills';
import type {SimInfo} from '../sim/SimView';
import {emptyFeed, packFor} from '../sim/radioFeed';
import {useCard} from '../sim/card';
import {loggedControls, replayStart, type Replay, type ReplayMode} from '../sim/replay';
import {motorCuts, stickManoeuvres} from '../sim/standIn';
import {joinSeries, packName, sortiePacks} from '../model/packs';
import {formatDay, formatTimer, plural} from '../model/format';
import type {TelemetrySeries} from '../types';
import {modelMapping} from '../sim/modelMixer';
import {RotorSound} from '../sim/sound';
import {radioName} from '../radio/widgets';

const SimView = lazy(() => import('../sim/SimView'));
const SimCockpit = lazy(() => import('../sim/SimCockpit'));

/** The browser keeps the sim's settings: the heli, the sticks' mapping and the best scores. */
const SETTINGS = 'flightdown.sim';

interface Settings {
  heliId?: string;
  /** The radio's screen over the view: shown unless hidden. */
  hideRadio?: boolean;
  /** The heli's sound: off unless turned on. */
  sound?: boolean;
  /** The view's zoom (ZOOM_RANGE), 1 unless changed. */
  zoom?: number;
  mapping?: Mapping;
  /** The longest hover in the box by facing, s, and the softest landing on the pad, m/s. */
  hover?: Partial<Record<Facing, number>>;
  landing?: number;
}

function readSettings(): Settings {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS) ?? '{}') as Settings;
  } catch {
    return {};
  }
}

function writeSettings(change: Partial<Settings>) {
  try {
    localStorage.setItem(SETTINGS, JSON.stringify({...readSettings(), ...change}));
  } catch {
    // Private browsing: the settings last the visit.
  }
}

/** The view's zoom slider, on the eyes' fixed lens: from twice as wide to three times closer. */
const ZOOM_RANGE = {min: 0.5, max: 3, step: 0.05};

const DRILLS: {value: DrillKind; label: string}[] = [
  {value: 'hover', label: 'Hover'},
  {value: 'landing', label: 'Soft landing'},
  {value: 'free', label: 'Free flight'},
];

const WINDS = [
  {value: '0', label: 'Calm'},
  {value: '10', label: '10 km/h'},
  {value: '20', label: '20 km/h'},
];

const STICKS: {stick: Stick; label: string}[] = [
  {stick: 'roll', label: 'Roll'},
  {stick: 'pitch', label: 'Pitch'},
  {stick: 'yaw', label: 'Rudder'},
  {stick: 'collective', label: 'Collective'},
  {stick: 'throttle', label: 'Throttle'},
];

/** A stick's value as a bar from its centre (-1 to 1), or from its bottom for the throttle (0 to 1). */
function StickBar({value, ghost, fromBottom = false}: {value: number; ghost?: number; fromBottom?: boolean}) {
  const left = fromBottom ? 0 : 50 + Math.min(0, value) * 50;
  const width = fromBottom ? value * 100 : Math.abs(value) * 50;
  const at = (position: number) => (fromBottom ? position * 100 : 50 + position * 50);
  return (
    <div className="sim-stick-bar">
      <span style={{left: `${left}%`, width: `${width}%`}} />
      {/* The log replayed: its stick as a tick. */}
      {ghost !== undefined && <i className="sim-stick-ghost" style={{left: `${at(ghost)}%`}} />}
    </div>
  );
}

/** The drill's state over the view. */
function DrillCard({info, facing, settings}: {info: SimInfo; facing: Facing; settings: Settings}) {
  const {drill} = info;
  if (drill.kind === 'hover') {
    const best = Math.max(drill.best, settings.hover?.[facing] ?? 0);
    return (
      <div className="sim-card">
        <b>
          {FACINGS.find(one => one.value === facing)?.label} hover {drill.inside ? '· in the box' : ''}
        </b>
        <span>
          {drill.streak.toFixed(1)} s of {HOVER_GOAL} s · best {best.toFixed(1)} s
        </span>
        <div className="sim-goal">
          <span style={{width: `${Math.min(1, drill.streak / HOVER_GOAL) * 100}%`}} />
        </div>
        {drill.streak >= HOVER_GOAL && <span className="sim-done">Done: try another facing</span>}
      </div>
    );
  }
  if (drill.kind === 'landing') {
    const best = drill.best?.speed ?? settings.landing;
    return (
      <div className="sim-card">
        <b>{drill.phase === 'climb' ? 'Take off and climb past 1 m' : 'Now land on the pad, softly'}</b>
        {drill.last && (
          <span>
            Last: {drill.last.grade}, {drill.last.speed.toFixed(2)} m/s
            {drill.last.onPad ? ', on the pad' : `, ${drill.last.distance.toFixed(1)} m off the pad`}
          </span>
        )}
        {best !== undefined && <span>Softest on the pad: {best.toFixed(2)} m/s</span>}
      </div>
    );
  }
  return (
    <div className="sim-card">
      <b>Free flight</b>
      <span>Fly anywhere: R or the button puts it back on the pad</span>
    </div>
  );
}

/** Each control of a game controller, the TX16S stick or switch it stands for, and its state now. */
function PadMap({info}: {info: SimInfo | null}) {
  const controls = info?.controls;
  const lit = {
    lt: !!controls?.throttle,
    rt: !!controls?.rescue,
    rb: isLowered(controls?.rates),
    up: controls?.armed !== false && !!controls,
    y: !!controls?.level,
  };
  const rows: {pad: string; radio: string; does: string; state?: string; lit?: boolean}[] = [
    {
      pad: 'LT',
      radio: 'SF',
      does: 'Motor on and off',
      state: controls && (controls.throttle ? 'On' : 'Hold'),
      lit: lit.lt,
    },
    {pad: '▲', radio: 'SA', does: 'Arm', state: controls && (lit.up ? 'Armed' : 'Safe'), lit: lit.up},
    {pad: 'LB', radio: 'SE', does: 'Idle up', state: controls && info ? `IU ${info.idleUp}` : undefined},
    {pad: 'RT', radio: 'SH', does: 'Rescue, held', state: lit.rt ? 'Rescue' : undefined, lit: lit.rt},
    {pad: 'RB', radio: 'SG', does: 'Rates', state: controls?.rates, lit: lit.rb},
    {pad: 'Y', radio: 'SC', does: 'Self-level', state: controls && (controls.level ? 'On' : 'Off'), lit: lit.y},
  ];
  const part = (on: boolean) => `sim-pad-part${on ? ' lit' : ''}`;
  return (
    <aside className="sim-side panel">
      <div className="sim-side-title">
        <b>Xbox → TX16S</b>
        <small className="muted">In use</small>
      </div>
      {/* A plain game controller seen from above, each control named after the radio's stick or switch it stands for. */}
      <svg
        className="sim-pad"
        viewBox="0 0 260 192"
        role="img"
        aria-label="The game controller's controls, by the radio's"
      >
        <rect className={part(lit.lt)} x="46" y="6" width="58" height="20" rx="7" />
        <text className="sim-pad-text" x="75" y="20">
          LT · SF
        </text>
        <rect className={part(lit.rt)} x="156" y="6" width="58" height="20" rx="7" />
        <text className="sim-pad-text" x="185" y="20">
          RT · SH
        </text>
        <rect className="sim-pad-part" x="38" y="29" width="68" height="15" rx="7" />
        <text className="sim-pad-text small" x="72" y="40">
          LB · SE {controls && info ? `IU${info.idleUp}` : ''}
        </text>
        <rect className={part(lit.rb)} x="154" y="29" width="68" height="15" rx="7" />
        <text className="sim-pad-text small" x="188" y="40">
          RB · SG
        </text>
        <path
          className="sim-pad-body"
          d="M70 46H190C222 46 238 64 246 94L256 150C260 172 246 188 228 184C214 181 204 168 196 154L184 138H76L64 154C56 168 46 181 32 184C14 188 0 172 4 150L14 94C22 64 38 46 70 46Z"
        />
        <circle className="sim-pad-part" cx="78" cy="86" r="18" />
        <text className="sim-pad-text small" x="78" y="84">
          Thr
        </text>
        <text className="sim-pad-text small" x="78" y="94">
          Rud
        </text>
        <circle className="sim-pad-part" cx="158" cy="122" r="18" />
        <text className="sim-pad-text small" x="158" y="120">
          Ail
        </text>
        <text className="sim-pad-text small" x="158" y="130">
          Ele
        </text>
        <path className="sim-pad-dim" d="M96 116h8v-8h8v8h8v8h-8v8h-8v-8h-8z" />
        <rect className={part(lit.up)} x="104" y="108" width="8" height="8" />
        <text className="sim-pad-text small" x="128" y="114">
          SA
        </text>
        <circle className="sim-pad-dim" cx="172" cy="86" r="7" />
        <circle className="sim-pad-dim" cx="200" cy="86" r="7" />
        <circle className="sim-pad-dim" cx="186" cy="100" r="7" />
        <circle className={part(lit.y)} cx="186" cy="72" r="8" />
        <text className="sim-pad-text small" x="186" y="75">
          Y
        </text>
        <text className="sim-pad-text small" x="210" y="66">
          SC
        </text>
      </svg>
      {rows.map(row => (
        <div key={row.pad} className="sim-map-row">
          <span className="sim-map-pad">{row.pad}</span>
          <span className="sim-map-radio">{row.radio}</span>
          <span className="sim-map-does">{row.does}</span>
          <span className={`sim-map-state ${row.lit ? 'lit' : ''}`}>{row.state ?? ''}</span>
        </div>
      ))}
      <div className="sim-map-row">
        <span className="sim-map-pad">Sticks</span>
        <span className="sim-map-radio">Mode 2</span>
        <span className="sim-map-does">Collective centred on hover pitch, upright or inverted</span>
        <span />
      </div>
    </aside>
  );
}

/**
 * The simulator: fly a heli on the computer with the TX16S plugged in (as a USB joystick), a game controller or the
 * keyboard, in drills for the hover and soft landings.
 */
export function Sim() {
  const {doc} = useStore();
  const color = useSeriesColor();
  const helis = useMemo(
    () => doc.helis.filter(heli => heli.status === 'active' || heli.status === 'grounded'),
    [doc.helis],
  );
  const [settings, setSettings] = useState(readSettings);
  const heli = helis.find(one => one.id === settings.heliId) ?? helis[0];
  const weight = heli?.weight;
  const rotor = heli?.rotor;
  const params = useMemo(() => heliParams({weight, rotor}), [weight, rotor]);
  const [drill, setDrill] = useState<DrillKind>('hover');
  const [facing, setFacing] = useState<Facing>('tail');
  const [wind, setWind] = useState('0');
  const [pad, setPad] = useState(0);
  const [restart, setRestart] = useState(0);
  const [info, setInfo] = useState<SimInfo | null>(null);
  const [setup, setSetup] = useState<{step: number; start: number[]; found: Partial<Mapping>} | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  // The heli's sound, kept by the page so its button can start it; closed when leaving.
  const noise = useMemo(() => new RotorSound(), []);
  useEffect(() => () => noise.close(), [noise]);
  // Left on last time: it comes back on the first click or key, the soonest a browser allows.
  useEffect(() => {
    if (!settings.sound) return;
    const wake = () => noise.start();
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [settings.sound, noise]);
  // The view takes the page's height under the toolbar, down to the bottom of the screen (above the dock on a phone).
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const fit = () => {
      const box = stage.current;
      if (!box || document.fullscreenElement) return;
      const top = box.getBoundingClientRect().top + window.scrollY;
      const dock = document.querySelector('.dock')?.getBoundingClientRect();
      const bottom = dock && dock.top > window.innerHeight / 2 ? dock.top - 12 : window.innerHeight - 16;
      setHeight(Math.max(360, Math.round(bottom - top)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  // The heli's model on the radio's card: the pad and keyboard fly through its mixer, the radio's outputs read
  // through its reversals unless the sticks were set up by hand.
  const card = useCard();
  const model = useMemo(
    () => (heli ? (card?.models.find(one => one.name === radioName(heli.name)) ?? null) : null),
    [card, heli],
  );
  const mapping = useMemo(() => settings.mapping ?? modelMapping(model), [settings.mapping, model]);
  // What the radio's screen reads, written by the view every frame; the pack the heli flies.
  const feed = useRef(emptyFeed());
  const pack = useMemo(() => packFor(heli, doc.batteries), [heli, doc.batteries]);

  const save = (change: Partial<Settings>) => {
    writeSettings(change);
    setSettings(current => ({...current, ...change}));
  };

  // A new best, kept for next time.
  useEffect(() => {
    const current = info?.drill;
    if (current?.kind === 'hover' && current.best > (settings.hover?.[current.facing] ?? 0) + 0.5) {
      save({hover: {...settings.hover, [current.facing]: current.best}});
    }
    if (current?.kind === 'landing' && current.best && current.best.speed < (settings.landing ?? Infinity)) {
      save({landing: current.best.speed});
    }
  }, [info]);

  // Setting up the sticks: each step waits for one axis to move, then the next starts from where the axes are.
  useEffect(() => {
    if (!setup || !info?.axes.length) return;
    const taken = Object.values(setup.found).map(found => found!.axis);
    const moved = movedAxis(setup.start, info.axes, taken);
    if (!moved) return;
    const found = {...setup.found, [SETUP_STEPS[setup.step].stick]: moved};
    if (setup.step + 1 < SETUP_STEPS.length) setSetup({step: setup.step + 1, start: info.axes, found});
    else {
      save({mapping: found as Mapping});
      setSetup(null);
    }
  }, [info]);

  const source = !info ? null : info.pad < 0 ? null : info.pads[info.pad];

  // A logged pack of this heli replayed: its packs, newest first.
  const {loadSeries} = useStore();
  const packs = useMemo(
    () =>
      [...doc.sorties]
        .filter(sortie => sortie.heliId === heli?.id && sortie.telemetry.length)
        .sort((left, right) => right.date.localeCompare(left.date))
        .flatMap(sortie => {
          const flights = sortiePacks(sortie);
          // Its day and time, the heli and the pack: "24 Nov 2026, 13:19 · M2 EVO · Eachine #1".
          return flights.map((flown, index) => ({
            key: `${sortie.id}:${index}`,
            pack: flown,
            label: [
              `${formatDay(sortie.date, {weekday: false, year: true})}${flown.start ? `, ${flown.start.slice(11, 16)}` : ''}`,
              heli?.name,
              packName(flown, doc.batteries, sortie.heliId) ?? `pack ${index + 1}`,
            ]
              .filter(Boolean)
              .join(' · '),
          }));
        }),
    [doc.sorties, doc.batteries, heli?.id, heli?.name],
  );
  const [packKey, setPackKey] = useState('');
  const [replayMode, setReplayMode] = useState<ReplayMode>('fly');
  const [replay, setReplay] = useState<Replay | null>(null);
  const [replayProblem, setReplayProblem] = useState('');
  const chosen = packs.find(one => one.key === packKey) ?? packs[0];
  // Dragged along the pack: the replay goes on from there, the heli back on the pad, as a fresh start at that moment.
  const seek = (second: number) =>
    setReplay(current => current && {...current, from: second, startedAt: performance.now()});
  const play = async () => {
    if (!chosen) return;
    const parts = await Promise.all(chosen.pack.files.map(file => loadSeries(file.id).catch(() => null)));
    if (parts.some(part => !part)) {
      setReplayProblem('The samples of this pack could not be read.');
      return;
    }
    setReplayProblem('');
    const series = joinSeries(chosen.pack, parts as TelemetrySeries[]);
    const logMapping = modelMapping(model);
    setReplay({
      series,
      mode: replayMode,
      startedAt: performance.now(),
      from: replayStart(series),
      stretches: stickManoeuvres(series, second => loggedControls(series, second, logMapping), params.cyclicRate),
      cuts: motorCuts(series, second => loggedControls(series, second, logMapping).throttle),
      label: chosen.label,
    });
  };
  // It stops by itself at the end of its log.
  useEffect(() => {
    if (replay && info && !info.replay && performance.now() - replay.startedAt > 500) setReplay(null);
  }, [info, replay]);
  // Another pack or way of replaying while one plays: it starts again from the top with it.
  const playing = !!replay;
  useEffect(() => {
    if (playing) void play();
  }, [packKey, replayMode]);
  const radio = source && !source.controller;
  // The game controller's map only with one plugged in and flown: no use for the radio or the keyboard.
  const padMap = !!source?.controller;

  return (
    <div className="page sim-page">
      <div className="toolbar sim-toolbar">
        <Segmented label="Drill" value={drill} onChange={setDrill} options={DRILLS} />
        {drill === 'hover' && (
          <select
            className="input"
            value={facing}
            onChange={event => setFacing(event.target.value as Facing)}
            aria-label="Facing"
          >
            {FACINGS.map(one => (
              <option key={one.value} value={one.value}>
                {one.label}
              </option>
            ))}
          </select>
        )}
        {helis.length > 1 && (
          <select
            className="input"
            value={heli?.id}
            onChange={event => save({heliId: event.target.value})}
            aria-label="Heli"
          >
            {helis.map(one => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </select>
        )}
        <Segmented label="Wind" value={wind} onChange={setWind} options={WINDS} />
        <button className="button" onClick={() => setRestart(count => count + 1)}>
          <RotateCcw size={15} /> Restart
        </button>
        <button
          className="button"
          aria-pressed={!!settings.sound}
          onClick={() => {
            // Started in the click itself: browsers let a page start sound no other way.
            if (!settings.sound) noise.start();
            save({sound: !settings.sound});
          }}
        >
          {settings.sound ? <Volume2 size={15} /> : <VolumeX size={15} />} Sound {settings.sound ? 'on' : 'off'}
        </button>
        <button
          className="button"
          aria-pressed={!settings.hideRadio}
          onClick={() => save({hideRadio: !settings.hideRadio})}
        >
          <Smartphone size={15} /> Radio screen
        </button>
        <button className="button" onClick={() => void stage.current?.requestFullscreen?.()}>
          <Maximize size={15} /> Full screen
        </button>
      </div>

      <div className={padMap ? 'sim-layout' : 'sim-layout alone'}>
        <div className="sim-main">
          <div ref={stage} className="sim-stage" style={height ? {height} : undefined}>
            <Suspense fallback={<div className="sim-stage-failed">Starting the sim…</div>}>
              <SimView
                params={params}
                color={color(heli?.color ?? 1)}
                drill={drill}
                facing={facing}
                wind={Number(wind)}
                mapping={mapping}
                pad={pad}
                restart={restart}
                replay={replay}
                onTakeOver={() => setReplay(null)}
                feed={feed}
                pack={pack}
                model={model}
                noise={noise}
                sound={!!settings.sound}
                zoom={settings.zoom ?? 1}
                onInfo={setInfo}
              />
            </Suspense>
            {heli && !settings.hideRadio && (
              <Suspense fallback={null}>
                <SimCockpit model={radioName(heli.name)} feed={feed} />
              </Suspense>
            )}
            {info && (
              <>
                <div className="sim-hud sim-hud-left">
                  <DrillCard info={info} facing={facing} settings={settings} />
                </div>
                <div className="sim-hud sim-hud-right">
                  <div className="sim-card sim-figures">
                    <span>Height</span>
                    <b>{info.height.toFixed(1)} m</b>
                    <span>Climb</span>
                    <b>{info.climb.toFixed(1)} m/s</b>
                    <span>Head</span>
                    <b>{Math.round(info.rpm / 10) * 10} rpm</b>
                    <span>Motor</span>
                    <b className={info.throttle ? 'live' : undefined}>
                      {info.throttle ? `${Math.round(info.throttle * 100)} %` : 'Hold'}
                    </b>
                    {info.controls.rates && (
                      <>
                        <span>Rates</span>
                        <b className={isLowered(info.controls.rates) ? 'practice' : undefined}>{info.controls.rates}</b>
                      </>
                    )}
                  </div>
                </div>
                {replay && info.replay && (
                  <div className="sim-replaying" role="status">
                    <span aria-hidden>▶</span> Replaying {replay.label} ·{' '}
                    {replay.mode === 'fly' ? 'flying it' : 'beside your sticks'} ·{' '}
                    {formatTimer(Math.round(info.replay.at))} of {formatTimer(Math.round(info.replay.end))}
                    {info.replay.pickedUp > 0 && ` · picked up ${plural(info.replay.pickedUp, 'time')}`}
                    {replay.mode === 'fly' && <small>Move a stick to take over</small>}
                  </div>
                )}
                {info.crashed && (
                  <div className="sim-crash">
                    <b>💥 {info.crashed}</b>
                    <span>Back on the pad in a moment</span>
                  </div>
                )}
                <div className="sim-hud sim-hud-bottom">
                  {/* Let go, it hands the keys back to the sticks; a double click sets it back to 1×. */}
                  <label className="sim-card sim-zoom" onDoubleClick={() => save({zoom: 1})}>
                    <ZoomIn size={14} aria-hidden />
                    <input
                      type="range"
                      aria-label="Zoom"
                      min={ZOOM_RANGE.min}
                      max={ZOOM_RANGE.max}
                      step={ZOOM_RANGE.step}
                      value={settings.zoom ?? 1}
                      onChange={event => save({zoom: Number(event.target.value)})}
                      onPointerUp={event => event.currentTarget.blur()}
                    />
                    <span>{(settings.zoom ?? 1).toFixed(1)}×</span>
                  </label>
                  <span className="sim-card sim-source">
                    {source
                      ? `${radio ? 'Radio' : 'Game controller'}: ${source.id.replace(/\s*\(.*$/, '')}`
                      : 'Keyboard: plug in the radio and move a stick'}
                  </span>
                </div>
              </>
            )}
          </div>
          {/* A pack replaying: where in it, right under the view. */}
          {replay && info?.replay && (
            <input
              type="range"
              className="sim-seek"
              min={replay.series.time[0] ?? 0}
              max={info.replay.end}
              step={0.1}
              value={info.replay.at}
              onChange={event => seek(Number(event.target.value))}
              aria-label="Where in the pack"
            />
          )}
        </div>
        {/* The game controller's map to the radio: none while the radio itself is plugged in. */}
        {padMap && <PadMap info={info} />}
      </div>

      <div className="bento sim-panels">
        <Panel
          label="Sticks"
          note={source ? 'What the sim reads from the controller' : 'Keyboard until a controller shows up'}
          className="span-5"
        >
          {info && (
            <div className="sim-sticks">
              {STICKS.map(({stick, label}) => (
                <div key={stick} className="sim-stick">
                  <span>{label}</span>
                  <StickBar
                    value={info.controls[stick]}
                    ghost={info.ghost?.[stick]}
                    fromBottom={stick === 'throttle'}
                  />
                  {radio && (
                    <small className="muted">
                      CH{mapping[stick].axis + 1}
                      {mapping[stick].reverse ? ' rev' : ''}
                    </small>
                  )}
                </div>
              ))}
            </div>
          )}
          {info && info.pads.length > 1 && (
            <select
              className="input"
              value={info.pad}
              onChange={event => setPad(Number(event.target.value))}
              aria-label="Controller"
            >
              {info.pads.map((one, index) => (
                <option key={one.id + index} value={index}>
                  {one.id.replace(/\s*\(.*$/, '')}
                </option>
              ))}
            </select>
          )}
          {radio &&
            (setup ? (
              <div className="sim-setup">
                <b>
                  {setup.step + 1} of {SETUP_STEPS.length}: {SETUP_STEPS[setup.step].ask}
                </b>
                <button className="button small ghost" onClick={() => setSetup(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="sim-setup">
                <button
                  className="button small"
                  onClick={() => info && setSetup({step: 0, start: info.axes, found: {}})}
                >
                  Set up the sticks
                </button>
                {settings.mapping && (
                  <button className="button small ghost" onClick={() => save({mapping: undefined})}>
                    Back to CH1 to CH6
                  </button>
                )}
              </div>
            ))}
        </Panel>

        <Panel
          label="Replay a pack"
          note="A real pack of this heli, from its log: watch it flown again, or try to fly it yourself"
          className="span-7"
        >
          {packs.length ? (
            <div className="sim-replay">
              <select
                className="input"
                value={chosen?.key}
                onChange={event => setPackKey(event.target.value)}
                aria-label="Pack"
              >
                {packs.map(one => (
                  <option key={one.key} value={one.key}>
                    {one.label}
                  </option>
                ))}
              </select>
              <Segmented
                label="Replay"
                value={replayMode}
                onChange={setReplayMode}
                options={[
                  {value: 'fly', label: 'Watch it'},
                  {value: 'sticks', label: 'Follow it'},
                ]}
              />
              {replay ? (
                <button className="button" onClick={() => setReplay(null)}>
                  <Square size={14} /> Stop
                </button>
              ) : (
                <button className="button" onClick={() => void play()}>
                  <Play size={14} /> Play
                </button>
              )}
              {info?.replay && (
                <span className="muted tabular">
                  {formatTimer(Math.round(info.replay.at))} of {formatTimer(Math.round(info.replay.end))}
                </span>
              )}
            </div>
          ) : (
            <div className="muted">No radio log for this heli yet.</div>
          )}
          {replayProblem && <p className="caption">{replayProblem}</p>}
          <p className="caption">
            Watch it: the logged sticks fly the heli, as you flew that pack, with the radio screen as it was. A log
            holds the sticks, not where the heli was, so a stand-in pilot adds the small corrections you made by eye and
            keeps it at a safe height (it stays out of the flips); after a crash it picks the heli up and the log goes
            on. Move a stick to take over. Follow it: you fly, and in the Sticks panel an amber mark on each bar shows
            where your stick was at that moment of the real pack: keep your sticks on the marks to fly it again.
          </p>
        </Panel>

        <Panel label="Plugging in the TX16S" className="span-12">
          <ol className="sim-help">
            <li>
              Pick the model you fly (the M2 EVO&apos;s): the sim reads its outputs, so its rates, curves, idle ups,
              hold and practice rates work as on the field. Keep the heli unplugged.
            </li>
            <li>
              In its model settings, set USB Joystick to Classic. Plug the radio into the Mac and pick USB Joystick
              (HID).
            </li>
            <li>Move a stick here: the sim finds it. If a stick moves the wrong way, set up the sticks once.</li>
            <li>
              Pick the same heli here as on the radio. SA (arm) and SF (throttle hold) come in as two buttons the model
              sends on CH10 and CH11, so each works on its own, as on the field.
            </li>
          </ol>
          <p className="caption">
            Game controller (mode 2): left stick collective and rudder, centred on hover pitch (inverted when upside
            down); right stick the cyclic; the D-pad's up arrow arms it, the left trigger turns the motor on and off,
            the right trigger is the rescue while held, LB steps the idle ups, RB the rates, Y self-level on and off.
            Keyboard: X arms it, arrows the cyclic, A and D the rudder, W and S the collective, Space the motor, Q cuts
            it, E the rescue while held, L self-level, P the rates, 1 to 3 the idle ups, R back on the pad.
          </p>
        </Panel>
      </div>
    </div>
  );
}
