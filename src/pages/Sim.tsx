import {lazy, Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {Maximize, Play, RotateCcw, Smartphone, Square, Volume2, VolumeX, ZoomIn} from 'lucide-react';
import {useStore} from '../data/store';
import {Segmented} from '../components/ui';
import {Panel} from '../components/instruments';
import {useSeriesColor} from '../components/colors';
import {heliParams} from '../sim/physics';
import {movedAxis, SETUP_STEPS, type Mapping} from '../sim/input';
import {FACINGS, type DrillKind, type Facing} from '../sim/drills';
import type {SimInfo} from '../sim/SimView';
import {createLive, useLive} from '../sim/live';
import {
  LiveCrash,
  LiveDrillCard,
  LiveFigures,
  LiveKeyMap,
  LivePadMap,
  LivePadPicker,
  LiveReplayBanner,
  LiveReplayClock,
  LiveSeek,
  LiveSticks,
  readSettings,
  writeSettings,
  type Settings,
} from '../sim/SimPanels';
import {emptyFeed, packFor} from '../sim/radioFeed';
import {useCard} from '../sim/card';
import {replayStart, type Replay, type ReplayMode} from '../sim/replay';
import {readReplay} from '../sim/replayPilot';
import {crashesIn, joinSeries, packName, sortiePacks} from '../model/packs';
import {formatDay} from '../model/format';
import type {TelemetrySeries} from '../types';
import {modelMapping} from '../sim/modelMixer';
import {RotorSound} from '../sim/sound';
import {radioName} from '../radio/widgets';

const SimView = lazy(() => import('../sim/SimView'));
const SimCockpit = lazy(() => import('../sim/SimCockpit'));

/** The view's zoom slider, on the eyes' fixed lens: from twice as wide to three times closer. */
const ZOOM_RANGE = {min: 0.5, max: 3, step: 0.05};

/** A replay's slow motion: real time, half and a quarter, to see a flip through. */
const SPEEDS = [
  {value: '1', label: '1×'},
  {value: '0.5', label: '½×'},
  {value: '0.25', label: '¼×'},
];

const DRILLS: {value: DrillKind; label: string}[] = [
  {value: 'free', label: 'Free flight'},
  {value: 'hover', label: 'Hover'},
  {value: 'landing', label: 'Soft landing'},
  {value: 'auto', label: 'Autorotation'},
];

const WINDS = [
  {value: '0', label: 'Calm'},
  {value: '10', label: '10 km/h'},
  {value: '20', label: '20 km/h'},
];

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
  const [drill, setDrill] = useState<DrillKind>('free');
  const [facing, setFacing] = useState<Facing>('tail');
  const [wind, setWind] = useState('0');
  const [pad, setPad] = useState(0);
  const [restart, setRestart] = useState(0);
  // The view's readings, ten times a second: the parts that show them pick them up themselves (see SimPanels).
  const live = useMemo(() => createLive<SimInfo | null>(null), []);
  const started = useLive(live, value => !!value);
  const sourceName = useLive(live, value => (value && value.pad >= 0 ? (value.pads[value.pad]?.id ?? null) : null));
  const controller = useLive(live, value => !!(value && value.pad >= 0 && value.pads[value.pad]?.controller));
  const replaying = useLive(live, value => !!value?.replay);
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
  useEffect(
    () =>
      live.subscribe(() => {
        const current = live.get()?.drill;
        if (current?.kind === 'hover' && current.best > (settings.hover?.[current.facing] ?? 0) + 0.5) {
          save({hover: {...settings.hover, [current.facing]: current.best}});
        }
        if (current?.kind === 'landing' && current.best && current.best.speed < (settings.landing ?? Infinity)) {
          save({landing: current.best.speed});
        }
        if (current?.kind === 'auto' && current.best && current.best.speed < (settings.auto ?? Infinity)) {
          save({auto: current.best.speed});
        }
      }),
    [live, settings.hover, settings.landing, settings.auto],
  );

  // Setting up the sticks: each step waits for one axis to move, then the next starts from where the axes are.
  useEffect(
    () =>
      live.subscribe(() => {
        const axes = live.get()?.axes;
        if (!setup || !axes?.length) return;
        const taken = Object.values(setup.found).map(found => found!.axis);
        const moved = movedAxis(setup.start, axes, taken);
        if (!moved) return;
        const found = {...setup.found, [SETUP_STEPS[setup.step].stick]: moved};
        if (setup.step + 1 < SETUP_STEPS.length) setSetup({step: setup.step + 1, start: axes, found});
        else {
          save({mapping: found as Mapping});
          setSetup(null);
        }
      }),
    [live, setup],
  );

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
            // Its crashes marked on the timeline, as seconds of its log.
            crashes: crashesIn(flown, sortie.crashTimes),
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
  const [replaySpeed, setReplaySpeed] = useState('1');
  // Slowed or sped up while it plays: it goes on from where it is.
  useEffect(() => setReplay(current => current && {...current, speed: Number(replaySpeed)}), [replaySpeed]);
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
      setReplayProblem(
        navigator.onLine
          ? 'The samples of this pack could not be read.'
          : 'No connection: the samples of this pack are not on this device yet.',
      );
      return;
    }
    setReplayProblem('');
    const series = joinSeries(chosen.pack, parts as TelemetrySeries[]);
    // Found before the clock starts: reading the whole log takes a moment, which would start the replay late.
    const {stretches, cuts} = readReplay(series, modelMapping(model), params);
    setReplay({
      series,
      mode: replayMode,
      startedAt: performance.now(),
      from: replayStart(series),
      stretches,
      cuts,
      crashes: chosen.crashes,
      label: chosen.label,
      key: chosen.key,
      start: chosen.pack.start,
      speed: Number(replaySpeed),
    });
  };
  // Following a pack: its share on the marks, kept as its best when it stops (played a minute at least, at full speed).
  // The last reading is kept as it plays: at the end of the log the view stops reporting the replay.
  const lastFollow = useRef<{at: number; share: number} | null>(null);
  useEffect(
    () =>
      live.subscribe(() => {
        const shown = live.get()?.replay;
        if (shown?.followed !== null && shown?.followed !== undefined) {
          lastFollow.current = {at: shown.at, share: shown.followed};
        }
      }),
    [live],
  );
  useEffect(() => {
    lastFollow.current = null;
    if (!replay || replay.mode !== 'sticks' || replay.speed !== 1) return;
    const {key, from} = replay;
    return () => {
      const last = lastFollow.current;
      if (!last || last.at - from < 60) return;
      const kept = readSettings().follow;
      if (last.share > (kept?.[key] ?? 0)) save({follow: {...kept, [key]: last.share}});
    };
  }, [replay?.startedAt, replay?.mode, replay?.speed]);

  // It stops by itself at the end of its log.
  useEffect(() => {
    if (replay && started && !replaying && performance.now() - replay.startedAt > 500) setReplay(null);
  }, [started, replaying, replay]);
  // Another pack or way of replaying while one plays: it starts again from the top with it.
  const playing = !!replay;
  useEffect(() => {
    if (playing) void play();
  }, [packKey, replayMode]);
  const radio = !!sourceName && !controller;
  // The game controller's map with one plugged in and flown, the keyboard's with nothing: none for the radio.
  const padMap = !!sourceName && controller;
  const keyMap = started && !sourceName;

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

      <div className={padMap || keyMap ? 'sim-layout' : 'sim-layout alone'}>
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
                onInfo={live.set}
              />
            </Suspense>
            {heli && !settings.hideRadio && (
              <Suspense fallback={null}>
                <SimCockpit model={radioName(heli.name)} feed={feed} />
              </Suspense>
            )}
            {started && (
              <>
                <div className="sim-hud sim-hud-left">
                  <LiveDrillCard live={live} facing={facing} settings={settings} />
                </div>
                <div className="sim-hud sim-hud-right">
                  <LiveFigures live={live} />
                </div>
                {replay && <LiveReplayBanner live={live} replay={replay} best={settings.follow?.[replay.key]} />}
                <LiveCrash live={live} flying={replay?.mode === 'fly'} />
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
                    {sourceName
                      ? `${radio ? 'Radio' : 'Game controller'}: ${sourceName.replace(/\s*\(.*$/, '')}`
                      : 'Keyboard: plug in the radio and move a stick'}
                  </span>
                </div>
              </>
            )}
          </div>
          {/* A pack replaying: where in it, right under the view. */}
          {replay && <LiveSeek live={live} replay={replay} onSeek={seek} />}
        </div>
        {/* The game controller's map to the radio: none while the radio itself is plugged in. */}
        {padMap && <LivePadMap live={live} />}
        {keyMap && <LiveKeyMap live={live} />}
      </div>

      <div className="bento sim-panels">
        <Panel
          label="Sticks"
          note={sourceName ? 'What the sim reads from the controller' : 'Keyboard until a controller shows up'}
          className="span-5"
        >
          <LiveSticks live={live} mapping={mapping} radio={radio} />
          <LivePadPicker live={live} onPick={setPad} />
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
                  onClick={() => {
                    const axes = live.get()?.axes;
                    if (axes) setSetup({step: 0, start: axes, found: {}});
                  }}
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
              <Segmented label="Speed" value={replaySpeed} onChange={setReplaySpeed} options={SPEEDS} />
              {replay ? (
                <button className="button" onClick={() => setReplay(null)}>
                  <Square size={14} /> Stop
                </button>
              ) : (
                <button className="button" onClick={() => void play()}>
                  <Play size={14} /> Play
                </button>
              )}
              <LiveReplayClock live={live} className="muted tabular" />
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
