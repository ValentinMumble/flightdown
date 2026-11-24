import {useId, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent} from 'react';
import {Activity, ArrowDown, ArrowUp, Minus} from 'lucide-react';
import {isOutput} from '../../model/telemetry';
import {type SwitchRole} from '../../radio/roles';
import {guessSignal, guessSwitch, signalLabel, type PackSignal} from '../../radio/widgets';

// The TX16S's switches, sticks and sources as the Radio tab draws and sets them.

/** What a source reads before anything sets it: the radio's own battery is not flat, SF down holds the throttle. */
export const RESTING: Record<string, number> = {TX_VOLTAGE: 8.1, SF: 1024};

/** A switch, a stick or an output: a position from -1024 to 1024. Anything else (a sensor) is a plain number. */
export const isPositional = (name: string) => /^S[A-Z]\d?$|switch|^ch\(|^I\d+$|^(Thr|Rud|Ele|Ail)$/i.test(name);

/** A switch: what the radio reads in its three positions. */
export const isSwitch = (name: string) => /^S[A-Z]\d?$|switch/i.test(name);

/** A source as one name whatever its case: EdgeTX reads "sh" as the switch SH. */
/**
 * The TX16S's sticks, knobs, sliders and buttons as Lua names them on the radio (EdgeTX 2.12.5, exactly), as the tab
 * does: a stick by its model file name, so a widget and the mixer move the same one.
 */
export const LUA_NAMES: Record<string, string> = {
  '6pos': '6P',
  s1: 'S1',
  s2: 'S2',
  ls: 'LS',
  rs: 'RS',
  ail: 'Ail',
  ele: 'Ele',
  thr: 'Thr',
  rud: 'Rud',
};
/** The same, as a model file names a widget's source option (EdgeTX 2.12: S1 is P1, the buttons P2). */
export const FILE_NAMES: Record<string, string> = {P1: 'S1', P2: '6P', P3: 'S2', SL1: 'LS', SL2: 'RS'};
export const sourceKey = (source: string) =>
  LUA_NAMES[source] ?? FILE_NAMES[source] ?? (/^s[a-z]$/i.test(source) ? source.toUpperCase() : source);

/**
 * The pack signal a source most likely follows: by its own name (a telemetry source by its sensor's, "tele(5)" being
 * VFAS), else by the option it feeds (SA feeds the ArmedModel's ArmedSwitch, so it follows the rotor), else by its role
 * on the model (`running`, from roles.ts: Arm and Throttle hold follow the rotor in a log that kept no switches).
 */
export function guessFor(
  source: string,
  sensors: string[],
  readers: Record<string, string>,
  signals: PackSignal[],
  running?: string,
) {
  const telemetry = /^tele\([-+]?(\d+)\)$/.exec(source);
  const named = telemetry ? (sensors[Number(telemetry[1])] ?? source) : source;
  return (
    guessSignal(named, signals) ||
    (readers[source] ? guessSignal(readers[source], signals) : '') ||
    guessSwitch(running, signals)
  );
}

export const POSITIONS = [
  {label: 'Up', at: -1024, Icon: ArrowUp},
  {label: 'Middle', at: 0, Icon: Minus},
  {label: 'Down', at: 1024, Icon: ArrowDown},
];

/**
 * The TX16S's switches where they sit, seen from the front: on each side the two on the shoulder, then the two on the
 * face. SF and SH have two positions (SH springs back).
 */
export const SIDES = {left: ['SE', 'SF', 'SA', 'SB'], right: ['SG', 'SH', 'SC', 'SD']};
export const TWO_POSITIONS = ['SF', 'SH'];

/** The 6-position buttons, and what the radio reads for each: -1024 to 1024 in six steps. */
export const BUTTONS = [1, 2, 3, 4, 5, 6];
export const buttonValue = (button: number) => Math.round(-1024 + (button - 1) * 409.6);

/**
 * Where a source rests until set: a 2-way switch up (it has no middle) unless listed, the 6-position buttons on
 * button 1, any other at 0 unless listed.
 */
export const restingValue = (name: string) =>
  RESTING[name] ?? (TWO_POSITIONS.includes(name) || name === '6P' ? -1024 : 0);

/** SH springs back: down only while held. */
export const MOMENTARY = ['SH'];
/** What a pack replayed drives again when chosen, whatever was moved by hand: the sticks, buttons and S1 knob. */
export const FROM_THE_PACK = ['Ail', 'Ele', 'Thr', 'Rud', '6P', 'S1'];
/** SH is the rescue switch: its cap is red. */
export const RED_CAPS = ['SH'];

/** How many ways a switch goes, as its tag says: 3-way, 2-way, or spring for SH. Empty for anything else. */
export const waysOf = (name: string) =>
  !/^S[A-H]$/.test(name) ? '' : MOMENTARY.includes(name) ? 'spring' : TWO_POSITIONS.includes(name) ? '2-way' : '3-way';

/** Where a click moves a switch: the other position on a 2-way, the next one down on a 3-way (back up from down). */
export function nextPosition(name: string, value: number) {
  const positions = TWO_POSITIONS.includes(name) ? POSITIONS.filter(one => one.at !== 0) : POSITIONS;
  const index = positions.findIndex(one => one.label.toLowerCase() === positionOf(value));
  return positions[(index + 1) % positions.length];
}

/** A switch's position from the value the radio reads: up below -512, down above 512, the middle between. */
export const positionOf = (value: number) => (value <= -512 ? 'up' : value >= 512 ? 'down' : 'middle');

/** How EdgeTX writes a switch position on screen: SA↑, SA-, SA↓. */
export const POSITION_MARK = {up: '↑', middle: '-', down: '↓'};

/** The switch's drawing, in its own units: the pivot, and how far the lever reaches out of it. */
export const PIVOT = {x: 24, y: 42};
export const REACH = 27;

/**
 * A toggle switch as on the radio, seen from the front: a hex nut and its washer, and a metal lever with a round cap
 * that stands up (leaning away, so a little smaller), points straight at you in the middle (the cap big, the lever
 * hidden behind it) or hangs down (leaning in). Its tile moves it (see SourceControl), a ghost cap showing where to on
 * hover; the lever itself is the button a keyboard reaches. A switch the pack drives moves on its own, its cap lit.
 */
export function SwitchLever({
  name,
  value,
  twoPositions,
  momentary,
  driven,
}: {
  name: string;
  value: number;
  twoPositions: boolean;
  momentary: boolean;
  driven: boolean;
}) {
  // SVG ids per switch, as a page draws eight of them.
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const position = positionOf(value);
  const lever = {
    up: {reach: -REACH, stretch: 1, cap: 0.9},
    middle: {reach: 0, stretch: 0.06, cap: 1.45},
    down: {reach: REACH, stretch: -1, cap: 1.08},
  }[position];
  const positions = twoPositions ? POSITIONS.filter(one => one.at !== 0) : POSITIONS;
  const next = nextPosition(name, value);
  const nut = Array.from({length: 6}, (_, corner) => {
    const angle = (Math.PI / 3) * corner + Math.PI / 6;
    return `${(PIVOT.x + 13 * Math.cos(angle)).toFixed(2)},${(PIVOT.y + 13 * Math.sin(angle)).toFixed(2)}`;
  }).join(' ');
  return (
    <div className={`radio-lever ${position}${driven ? ' driven' : ''}`} role="group" aria-label={name}>
      <svg viewBox="0 0 48 84" aria-hidden>
        <defs>
          <linearGradient id={`${id}-metal`} x1="0" x2="1">
            <stop offset="0" stopColor="#6b7581" />
            <stop offset="0.38" stopColor="#f4f7fa" />
            <stop offset="0.62" stopColor="#c3cbd4" />
            <stop offset="1" stopColor="#5c6570" />
          </linearGradient>
          <radialGradient id={`${id}-cap`} cx="0.36" cy="0.32" r="0.75">
            {(RED_CAPS.includes(name) ? ['#ffd2d2', '#ff4d4f', '#8a1c20'] : ['#ffffff', '#d3dae2', '#707b87']).map(
              (color, stop) => (
                <stop key={color} offset={stop / 2} stopColor={color} />
              ),
            )}
          </radialGradient>
          <linearGradient id={`${id}-nut`} x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0" stopColor="#4b545e" />
            <stop offset="0.5" stopColor="#2a3037" />
            <stop offset="1" stopColor="#1b1f24" />
          </linearGradient>
        </defs>
        <circle
          className="lever-ghost"
          cx={PIVOT.x}
          cy={PIVOT.y + Math.sign(next.at) * REACH}
          r={next.at === 0 ? 6.5 : 4.4}
        />
        {positions.map(one => {
          const y = PIVOT.y + Math.sign(one.at) * REACH;
          const on = position === one.label.toLowerCase();
          // A spring switch does not stay down: its marks there are dashed.
          const springy = momentary && one.at > 0;
          return (
            <g
              key={`notch-${one.label}`}
              className={['lever-notch', on && 'on', springy && 'spring'].filter(Boolean).join(' ')}
            >
              <line x1={PIVOT.x - 15} x2={PIVOT.x - 9} y1={y} y2={y} />
              <line x1={PIVOT.x + 9} x2={PIVOT.x + 15} y1={y} y2={y} />
            </g>
          );
        })}
        <polygon points={nut} fill={`url(#${id}-nut)`} className="lever-nut" />
        <circle cx={PIVOT.x} cy={PIVOT.y} r={9} className="lever-washer" />
        <circle cx={PIVOT.x} cy={PIVOT.y} r={5.6} className="lever-collar" />
        <g className="lever-shaft" style={{transform: `scaleY(${lever.stretch})`}}>
          <path
            d={`M${PIVOT.x - 3.2} ${PIVOT.y} L${PIVOT.x - 2.1} ${PIVOT.y - REACH + 2} L${PIVOT.x + 2.1} ${PIVOT.y - REACH + 2} L${PIVOT.x + 3.2} ${PIVOT.y} Z`}
            fill={`url(#${id}-metal)`}
          />
        </g>
        <g className="lever-cap" style={{transform: `translateY(${lever.reach}px) scale(${lever.cap})`}}>
          <ellipse cx={PIVOT.x} cy={PIVOT.y} rx={4.6} ry={4.3} fill={`url(#${id}-cap)`} />
          <ellipse cx={PIVOT.x - 1.4} cy={PIVOT.y - 1.5} rx={1.5} ry={1.1} className="lever-glint" />
        </g>
      </svg>
      {!driven && (
        <button
          type="button"
          className="lever-zone"
          aria-label={`${name} ${position}`}
          title={momentary ? 'Hold it down' : `Move it ${next.label.toLowerCase()}`}
        />
      )}
    </div>
  );
}

/**
 * A source the widgets read, as a small tile: a switch drawn as one, up, middle or down for a stick or an output, a
 * number for a sensor; by hand, or a signal of the pack replayed.
 */
export function SourceControl({
  name,
  label,
  value,
  onChange,
  channel,
  channels,
  onBind,
  unused = false,
  hint,
  role,
  packSignal = 'running',
}: {
  name: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  channel?: PackSignal | '';
  channels: PackSignal[];
  onBind: (channel: PackSignal | '') => void;
  /** A switch no widget on the screen reads: still there, as on the radio, but dimmed. */
  unused?: boolean;
  /** What reads it, from the model's widget options: SA is the ArmedModel's ArmedSwitch. */
  hint?: string;
  /** What the switch does on the model, position by position. */
  role?: SwitchRole;
  /** The signal the switch takes from a pack when set so: the rotor turning, unless its reader says otherwise. */
  packSignal?: PackSignal;
}) {
  const fromLog = Boolean(channel);
  const positional = isPositional(name);
  const positions = TWO_POSITIONS.includes(name) ? POSITIONS.filter(position => position.at !== 0) : POSITIONS;
  const effect = role?.[positionOf(value)];
  const roleLines = role
    ? positions.flatMap(({label: position}) => {
        const [what, detail] = role[position.toLowerCase() as keyof typeof POSITION_MARK] ?? [];
        return what ? [`${position}: ${what}${detail ? `, ${detail}` : ''}`] : [];
      })
    : [];
  const reader = hint ? `${label}: ${hint}` : label;
  const title = [role ? `${reader}, ${role.job}` : reader, ...roleLines].join('\n');

  // A switch set by hand moves wherever its tile is clicked, except on the tile's other buttons. SH springs back, so
  // it stays down only while the pointer, Space or Enter holds it.
  const switchable = isSwitch(name) && !fromLog;
  const momentary = MOMENTARY.includes(name);
  const held = useRef(false);
  const onOtherControl = (target: EventTarget) =>
    (target as Element).closest('button:not(.lever-zone), select, input') !== null;
  const hold = (down: boolean) => {
    if (held.current === down) return;
    held.current = down;
    onChange(down ? 1024 : -1024);
  };
  const holdKey = (event: KeyboardEvent, down: boolean) => {
    if ((event.key === ' ' || event.key === 'Enter') && (event.target as Element).classList.contains('lever-zone')) {
      hold(down);
    }
  };
  const moves = !switchable
    ? {}
    : momentary
      ? {
          onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
            if (event.button !== 0 || onOtherControl(event.target)) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            hold(true);
          },
          onPointerUp: () => hold(false),
          onPointerCancel: () => hold(false),
          onKeyDown: (event: KeyboardEvent) => holdKey(event, true),
          onKeyUp: (event: KeyboardEvent) => holdKey(event, false),
          onBlur: () => hold(false),
        }
      : {
          onClick: (event: MouseEvent) => {
            if (!onOtherControl(event.target)) onChange(nextPosition(name, value).at);
          },
        };
  return (
    <div
      className={[
        'radio-input',
        fromLog && 'from-pack',
        unused && 'unused',
        switchable && 'switchable',
        switchable && momentary && 'momentary',
      ]
        .filter(Boolean)
        .join(' ')}
      {...moves}
    >
      <div className="radio-input-head">
        <span className="radio-input-name" title={title}>
          {label}
          {isSwitch(name) && <span className="radio-switch-mark">{POSITION_MARK[positionOf(value)]}</span>}
          {/* What it is for, and how many ways it goes as a tag, on a line that wraps rather than cuts. */}
          {(role || hint || isSwitch(name)) && (
            <small>
              {role?.job ?? hint}
              {isSwitch(name) && (
                <span className="radio-switch-ways" title={momentary ? 'It springs back up when let go' : undefined}>
                  {waysOf(name)}
                </span>
              )}
            </small>
          )}
        </span>
        {!fromLog && positional && !isSwitch(name) && <span className="radio-value">{value}</span>}
        {channels.length > 0 && isSwitch(name) && (
          <button
            type="button"
            className="icon-button radio-input-follow"
            aria-pressed={fromLog}
            aria-label={fromLog ? `${name}: set it by hand` : `${name}: follow the pack`}
            onClick={() => onBind(fromLog ? '' : packSignal)}
            title={fromLog ? 'Set it by hand' : `Follow the pack: ${signalLabel(packSignal)}`}
          >
            <Activity size={13} />
          </button>
        )}
      </div>
      {isSwitch(name) ? (
        <SwitchLever
          name={name}
          value={value}
          twoPositions={TWO_POSITIONS.includes(name)}
          momentary={momentary}
          driven={fromLog}
        />
      ) : fromLog ? (
        <div className="radio-input-pack">{signalLabel(channel as PackSignal)}</div>
      ) : positional ? (
        <div className="radio-positions" role="group" aria-label={name}>
          {positions.map(({label: position, at, Icon}) => (
            <button
              key={position}
              type="button"
              className="chip"
              aria-label={position}
              title={position}
              aria-pressed={value === at}
              onClick={() => onChange(at)}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
      ) : (
        <input
          className="input"
          type="number"
          step="0.1"
          value={value}
          onChange={event => onChange(Number(event.target.value))}
          aria-label={`${name} value`}
        />
      )}
      {isSwitch(name) && (roleLines.length > 0 || unused) && (
        // Every position's word in one cell, only the current one seen: the tile keeps one height, so a switch moved
        // (SH held for the rescue) does not push the others.
        <p className="radio-switch-role" aria-live="polite">
          {roleLines.length > 0
            ? positions.map(({label: position}) => {
                const words = role?.[position.toLowerCase() as keyof typeof POSITION_MARK];
                const current = words === effect;
                // The word only: what it does in full is the tile's tooltip.
                return (
                  <span key={position} className="radio-switch-effect" aria-hidden={!current}>
                    {words && <strong>{words[0]}</strong>}
                  </span>
                );
              })
            : 'Not used'}
        </p>
      )}
      {/* A spring switch held (SH, the rescue): what it does now, in full, floating out of the tile. */}
      {momentary && value > 0 && effect?.[1] && (
        <span className="radio-switch-tip" role="tooltip">
          {effect[1]}
        </span>
      )}
      {channels.length > 0 && !isSwitch(name) && (
        <select
          className="input radio-input-bind"
          value={channel ?? ''}
          onChange={event => onBind(event.target.value as PackSignal | '')}
          aria-label={`${name} from the pack`}
        >
          <option value="">By hand</option>
          {channels
            .filter(one => !isOutput(one))
            .map(one => (
              <option key={one} value={one}>
                Pack: {signalLabel(one)}
              </option>
            ))}
        </select>
      )}
    </div>
  );
}
