import {lazy, Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {Maximize, RotateCcw} from 'lucide-react';
import {useStore} from '../data/store';
import {PageHeader, Segmented} from '../components/ui';
import {Panel} from '../components/instruments';
import {useSeriesColor} from '../components/colors';
import {heliParams} from '../sim/physics';
import {DEFAULT_MAPPING, movedAxis, SETUP_STEPS, type Mapping, type Stick} from '../sim/input';
import {FACINGS, HOVER_GOAL, type DrillKind, type Facing} from '../sim/drills';
import type {SimInfo} from '../sim/SimView';

const SimView = lazy(() => import('../sim/SimView'));

/** The browser keeps the sim's settings: the heli, the sticks' mapping and the best scores. */
const SETTINGS = 'flightdown.sim';

interface Settings {
  heliId?: string;
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
function StickBar({value, fromBottom = false}: {value: number; fromBottom?: boolean}) {
  const left = fromBottom ? 0 : 50 + Math.min(0, value) * 50;
  const width = fromBottom ? value * 100 : Math.abs(value) * 50;
  return (
    <div className="sim-stick-bar">
      <span style={{left: `${left}%`, width: `${width}%`}} />
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
  const mapping = settings.mapping ?? DEFAULT_MAPPING;

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
  const radio = source && !source.controller;

  return (
    <div className="page">
      <PageHeader title="Sim" sub="Fly on the computer: hover and soft landing drills, with the TX16S plugged in" />

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
        <button className="button ghost" onClick={() => void stage.current?.requestFullscreen?.()}>
          <Maximize size={15} /> Full screen
        </button>
      </div>

      <div ref={stage} className="sim-stage">
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
            onInfo={setInfo}
          />
        </Suspense>
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
              </div>
            </div>
            {info.crashed && (
              <div className="sim-crash">
                <b>💥 {info.crashed}</b>
                <span>Throttle hold to start again on the pad</span>
              </div>
            )}
            <div className="sim-hud sim-hud-bottom">
              <span className="sim-card sim-source">
                {source
                  ? `${radio ? 'Radio' : 'Game controller'}: ${source.id.replace(/\s*\(.*$/, '')}`
                  : 'Keyboard: plug in the radio and move a stick'}
              </span>
            </div>
          </>
        )}
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
                  <StickBar value={info.controls[stick]} fromBottom={stick === 'throttle'} />
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

        <Panel label="Plugging in the TX16S" className="span-7">
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
          </ol>
          <p className="caption">
            Game controller (mode 2): left stick collective and rudder, centred on hover pitch; right stick the cyclic;
            A starts and stops the motor, Y steps the idle ups. Keyboard: arrows the cyclic, A and D the rudder, W and S
            the collective, Space the motor, 1 to 3 the idle ups, R back on the pad.
          </p>
        </Panel>
      </div>
    </div>
  );
}
