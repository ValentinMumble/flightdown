import {isLowered, type Mapping, type Stick} from './input';
import {FACINGS, HOVER_GOAL, type Facing} from './drills';
import type {SimInfo} from './SimView';
import type {Replay} from './replay';
import {useLive, type Live} from './live';
import {formatTimer, plural} from '../model/format';
import {readJson, writeJson} from '../data/storage';

// The sim page's panels and the readings over its view. The readings change ten times a second: each part picks what it
// shows from the live readings (see live.ts), so the page around them does not render again with them.

export type LiveInfo = Live<SimInfo | null>;

/** The browser keeps the sim's settings: the heli, the sticks' mapping and the best scores. */
const SETTINGS = 'flightdown.sim';

export interface Settings {
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

export const readSettings = (): Settings => readJson<Settings>(SETTINGS) ?? {};

/** Private browsing: the settings last the visit. */
export const writeSettings = (change: Partial<Settings>) => writeJson(SETTINGS, {...readSettings(), ...change});

export const STICKS: {stick: Stick; label: string}[] = [
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
/** The keyboard's keys, when nothing is plugged in: each with the radio's stick or switch it stands for. */
function KeyMap({info}: {info: SimInfo | null}) {
  const controls = info?.controls;
  const rows: {keys: string; radio: string; does: string; state?: string; lit?: boolean}[] = [
    {
      keys: 'W S',
      radio: 'Thr',
      does: 'Collective, up and down',
      state: controls && `${Math.round(controls.collective * 100)} %`,
    },
    {keys: 'A D', radio: 'Rud', does: 'Rudder'},
    {keys: '← →', radio: 'Ail', does: 'Roll'},
    {keys: '↑ ↓', radio: 'Ele', does: 'Pitch'},
    {
      keys: 'X',
      radio: 'SA',
      does: 'Arm',
      state: controls && (controls.armed ? 'Armed' : 'Safe'),
      lit: !!controls?.armed,
    },
    {
      keys: 'Space',
      radio: 'SF',
      does: 'Motor on and off (Q: hold)',
      state: controls && (controls.throttle ? 'On' : 'Hold'),
      lit: !!controls?.throttle,
    },
    {keys: '1 2 3', radio: 'SE', does: 'Idle up', state: controls && info ? `IU ${info.idleUp}` : undefined},
    {
      keys: 'E',
      radio: 'SH',
      does: 'Rescue, held',
      state: controls?.rescue ? 'Rescue' : undefined,
      lit: !!controls?.rescue,
    },
    {keys: 'P', radio: 'SG', does: 'Rates', state: controls?.rates, lit: isLowered(controls?.rates)},
    {
      keys: 'L',
      radio: 'SC',
      does: 'Self-level',
      state: controls && (controls.level ? 'On' : 'Off'),
      lit: !!controls?.level,
    },
  ];
  return (
    <aside className="sim-side panel">
      <div className="sim-side-title">
        <b>Keyboard → TX16S</b>
        <small className="muted">Plug in the radio or a game controller to fly with sticks</small>
      </div>
      {rows.map(row => (
        <div key={row.keys} className="sim-map-row">
          <span className="sim-map-pad">{row.keys}</span>
          <span className="sim-map-radio">{row.radio}</span>
          <span className="sim-map-does">{row.does}</span>
          <span className={`sim-map-state ${row.lit ? 'lit' : ''}`}>{row.state ?? ''}</span>
        </div>
      ))}
    </aside>
  );
}

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

/** The drill's card, over the view's top left. */
export function LiveDrillCard({live, facing, settings}: {live: LiveInfo; facing: Facing; settings: Settings}) {
  const info = useLive(live, value => value);
  return info && <DrillCard info={info} facing={facing} settings={settings} />;
}

/** Height, climb, head speed, motor and rates, over the view's top right. */
export function LiveFigures({live}: {live: LiveInfo}) {
  const info = useLive(live, value => value);
  if (!info) return null;
  return (
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
  );
}

/** Where a replay is in its pack: "1:12 of 2:34". */
export function LiveReplayClock({live, className}: {live: LiveInfo; className?: string}) {
  const at = useLive(live, value => (value?.replay ? Math.round(value.replay.at) : null));
  const end = useLive(live, value => (value?.replay ? Math.round(value.replay.end) : null));
  if (at === null || end === null) return null;
  return (
    <span className={className}>
      {formatTimer(at)} of {formatTimer(end)}
    </span>
  );
}

/** The replay playing, over the view. */
export function LiveReplayBanner({live, replay}: {live: LiveInfo; replay: Replay}) {
  const playing = useLive(live, value => !!value?.replay);
  const pickedUp = useLive(live, value => value?.replay?.pickedUp ?? 0);
  if (!playing) return null;
  return (
    <div className="sim-replaying" role="status">
      <span aria-hidden>▶</span> Replaying {replay.label} · {replay.mode === 'fly' ? 'flying it' : 'beside your sticks'}{' '}
      · <LiveReplayClock live={live} />
      {pickedUp > 0 && ` · picked up ${plural(pickedUp, 'time')}`}
      {replay.mode === 'fly' && <small>Move a stick to take over</small>}
    </div>
  );
}

/** A crash, over the view. */
export function LiveCrash({live, flying}: {live: LiveInfo; flying: boolean}) {
  const crashed = useLive(live, value => value?.crashed ?? null);
  if (!crashed) return null;
  return (
    <div className="sim-crash">
      <b>💥 {crashed}</b>
      <span>{flying ? 'Picked up, the log goes on' : 'Back on the pad in a moment'}</span>
    </div>
  );
}

/** A replay's place in its pack, to drag. */
export function LiveSeek({live, replay, onSeek}: {live: LiveInfo; replay: Replay; onSeek: (second: number) => void}) {
  const at = useLive(live, value => value?.replay?.at ?? null);
  const end = useLive(live, value => value?.replay?.end ?? null);
  if (at === null || end === null) return null;
  return (
    <input
      type="range"
      className="sim-seek"
      min={replay.series.time[0] ?? 0}
      max={end}
      step={0.1}
      value={at}
      onChange={event => onSeek(Number(event.target.value))}
      aria-label="Where in the pack"
    />
  );
}

/** The sticks as the sim reads them, and the replayed pack's as ticks. */
export function LiveSticks({live, mapping, radio}: {live: LiveInfo; mapping: Mapping; radio: boolean}) {
  const info = useLive(live, value => value);
  if (!info) return null;
  return (
    <div className="sim-sticks">
      {STICKS.map(({stick, label}) => (
        <div key={stick} className="sim-stick">
          <span>{label}</span>
          <StickBar value={info.controls[stick]} ghost={info.ghost?.[stick]} fromBottom={stick === 'throttle'} />
          {radio && (
            <small className="muted">
              CH{mapping[stick].axis + 1}
              {mapping[stick].reverse ? ' rev' : ''}
            </small>
          )}
        </div>
      ))}
    </div>
  );
}

/** The controllers plugged in, when there are several: which one flies. */
export function LivePadPicker({live, onPick}: {live: LiveInfo; onPick: (pad: number) => void}) {
  const names = useLive(live, value => value?.pads.map(pad => pad.id).join('\n') ?? '');
  const pad = useLive(live, value => value?.pad ?? -1);
  const list = names ? names.split('\n') : [];
  if (list.length < 2) return null;
  return (
    <select
      className="input"
      value={pad}
      onChange={event => onPick(Number(event.target.value))}
      aria-label="Controller"
    >
      {list.map((name, index) => (
        <option key={name + index} value={index}>
          {name.replace(/\s*\(.*$/, '')}
        </option>
      ))}
    </select>
  );
}

/** The keyboard's map, or the game controller's, with the state of each control. */
export function LiveKeyMap({live}: {live: LiveInfo}) {
  return <KeyMap info={useLive(live, value => value)} />;
}

export function LivePadMap({live}: {live: LiveInfo}) {
  return <PadMap info={useLive(live, value => value)} />;
}
