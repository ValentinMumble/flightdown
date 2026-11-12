import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import {Activity, ArrowDown, ArrowUp, Download, Minus, Pause, Play, RotateCcw} from 'lucide-react';
import type {TelemetrySeries} from '../types';
import {useStore} from '../data/store';
import {Segmented} from '../components/ui';
import {Panel} from '../components/instruments';
import {cutout} from '../components/HeliPhoto';
import {buttonPack, groupPacks, joinSeries} from '../model/packs';
import {formatDay, formatTimer, plural} from '../model/format';
import {buttonOf, isOutput} from '../model/telemetry';
import {Radio, SCREEN, startLua, type RadioInputs, type WidgetOption, type WidgetRunner} from '../radio/edgetx';
import {ModelTimers} from '../radio/timers';
import {describeLogic} from '../radio/logic';
import {RadioLogic} from '../components/RadioLogic';
import type {Card} from '../radio/card';
import {switchRole, type SwitchRole} from '../radio/roles';
import {mainView, TOP_BAR} from '../radio/layout';
import {
  drawBuiltin,
  drawChrome,
  drawMissing,
  isBuiltin,
  loadCardWidget,
  optionLines,
  placeScreen,
  type Placed,
} from '../radio/screen';
import {
  guessSignal,
  listWidgets,
  radioFile,
  packSignals,
  radioName,
  signalLabel,
  sourceValue,
  widgetCode,
  type PackSignal,
  type WidgetFile,
} from '../radio/widgets';
import '../styles/radio.css';

type Mode = 'screen' | 'widget';
/** What the tab shows: a mode, or the model's screens with its logic under them. */
type Shown = Mode | 'logic';

/** Zones a widget can sit in on the TX16S, measured from EdgeTX: the M2 EVO's first. */
const ALL_DECORATIONS = {topbar: true, flightMode: true, sliders: true, trims: true, mirrored: false};
const VIEW = mainView(ALL_DECORATIONS);
const ZONES = [
  {key: 'top-left', label: 'M2 EVO screen, top left', width: VIEW.w / 2, height: Math.trunc(VIEW.h / 2)},
  {key: 'right', label: 'Layout 2 + 1, right', width: VIEW.w / 2, height: VIEW.h},
  {key: 'view', label: 'Whole main view', width: VIEW.w, height: VIEW.h},
  {key: 'full', label: 'Full screen', width: SCREEN.width, height: SCREEN.height},
  {key: 'topbar', label: 'Top bar slot', width: 74, height: TOP_BAR - 6},
];
const SPEEDS = ['1', '2', '4'];
/** What a source reads before anything sets it: the radio's own battery is not flat, SF down holds the throttle. */
const RESTING: Record<string, number> = {TX_VOLTAGE: 8.1, SF: 1024};

const PREFERENCES = 'flightdown.radio';
const CODE = 'flightdown.radio.code.';

function remembered(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PREFERENCES) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(PREFERENCES, JSON.stringify({...remembered(), [key]: value}));
  } catch {
    // Private browsing: the choice is just not kept.
  }
}

function storedCode(file: string) {
  try {
    return localStorage.getItem(CODE + file);
  } catch {
    return null;
  }
}

function storeCode(file: string, code: string | null) {
  try {
    if (code === null) localStorage.removeItem(CODE + file);
    else localStorage.setItem(CODE + file, code);
  } catch {
    // Not kept: the edit lasts until the page closes.
  }
}

const message = (error: unknown) => String((error as Error)?.message ?? error);

/** A switch, a stick or an output: a position from -1024 to 1024. Anything else (a sensor) is a plain number. */
const isPositional = (name: string) => /^S[A-Z]\d?$|switch|^ch\(|^I\d+$|^(Thr|Rud|Ele|Ail)$/i.test(name);

/** A switch: what the radio reads in its three positions. */
const isSwitch = (name: string) => /^S[A-Z]\d?$|switch/i.test(name);

/** A source as one name whatever its case: EdgeTX reads "sh" as the switch SH. */
const sourceKey = (source: string) => (/^s[a-z]$/i.test(source) ? source.toUpperCase() : source);

/**
 * The pack signal a source most likely follows: by its own name (a telemetry source by its sensor's, "tele(5)" being
 * VFAS), else by the option it feeds (SA feeds the ArmedModel's ArmedSwitch, so it follows the rotor).
 */
function guessFor(source: string, sensors: string[], readers: Record<string, string>, signals: PackSignal[]) {
  const telemetry = /^tele\([-+]?(\d+)\)$/.exec(source);
  const named = telemetry ? (sensors[Number(telemetry[1])] ?? source) : source;
  return guessSignal(named, signals) || (readers[source] ? guessSignal(readers[source], signals) : '');
}

const POSITIONS = [
  {label: 'Up', at: -1024, Icon: ArrowUp},
  {label: 'Middle', at: 0, Icon: Minus},
  {label: 'Down', at: 1024, Icon: ArrowDown},
];

/**
 * The TX16S's switches where they sit, seen from the front: on each side the two on the shoulder, then the two on the
 * face. SF and SH have two positions (SH springs back).
 */
const SIDES = {left: ['SE', 'SF', 'SA', 'SB'], right: ['SG', 'SH', 'SC', 'SD']};
const TWO_POSITIONS = ['SF', 'SH'];

/** The 6-position buttons, and what the radio reads for each: -1024 to 1024 in six steps. */
const BUTTONS = [1, 2, 3, 4, 5, 6];
const buttonValue = (button: number) => Math.round(-1024 + (button - 1) * 409.6);

/**
 * Where a source rests until set: a 2-way switch up (it has no middle) unless listed, the 6-position buttons on
 * button 1, any other at 0 unless listed.
 */
const restingValue = (name: string) => RESTING[name] ?? (TWO_POSITIONS.includes(name) || name === '6P' ? -1024 : 0);

/** SH springs back: down only while held. */
const MOMENTARY = ['SH'];
/** SH is the rescue switch: its cap is red. */
const RED_CAPS = ['SH'];

/** How many ways a switch goes, as its tag says: 3-way, 2-way, or spring for SH. Empty for anything else. */
const waysOf = (name: string) =>
  !/^S[A-H]$/.test(name) ? '' : MOMENTARY.includes(name) ? 'spring' : TWO_POSITIONS.includes(name) ? '2-way' : '3-way';

/** Where a click moves a switch: the other position on a 2-way, the next one down on a 3-way (back up from down). */
function nextPosition(name: string, value: number) {
  const positions = TWO_POSITIONS.includes(name) ? POSITIONS.filter(one => one.at !== 0) : POSITIONS;
  const index = positions.findIndex(one => one.label.toLowerCase() === positionOf(value));
  return positions[(index + 1) % positions.length];
}

/** A switch's position from the value the radio reads: up below -512, down above 512, the middle between. */
const positionOf = (value: number) => (value <= -512 ? 'up' : value >= 512 ? 'down' : 'middle');

/** How EdgeTX writes a switch position on screen: SA↑, SA-, SA↓. */
const POSITION_MARK = {up: '↑', middle: '-', down: '↓'};

/** The switch's drawing, in its own units: the pivot, and how far the lever reaches out of it. */
const PIVOT = {x: 24, y: 42};
const REACH = 27;

/**
 * A toggle switch as on the radio, seen from the front: a hex nut and its washer, and a metal lever with a round cap
 * that stands up (leaning away, so a little smaller), points straight at you in the middle (the cap big, the lever
 * hidden behind it) or hangs down (leaning in). Its tile moves it (see SourceControl), a ghost cap showing where to on
 * hover; the lever itself is the button a keyboard reaches. A switch the pack drives moves on its own, its cap lit.
 */
function SwitchLever({
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
function SourceControl({
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
      {isSwitch(name) && (effect || unused) && (
        <p className="radio-switch-role" aria-live="polite">
          {effect ? (
            <>
              <strong>{effect[0]}</strong>
              {effect[1] && <span>{effect[1]}</span>}
            </>
          ) : (
            'Not used'
          )}
        </p>
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

/**
 * The radio's screen in the Hangar, a TX16S in the browser. Model screens: any model from the radio's card, its
 * screens as the radio draws them, every widget in its zone. One widget: a widget built in edge-tx, the very Lua that
 * goes on the radio, in a zone of its size, with its Lua to edit. Both read the switches set here, or a logged pack
 * replayed through them.
 */
export default function RadioView() {
  const {doc, loadSeries} = useStore();
  const canvas = useRef<HTMLCanvasElement>(null);
  const radio = useRef<Radio | null>(null);
  const runner = useRef<WidgetRunner | null>(null);
  const inputs = useRef<RadioInputs | null>(null);

  const saved = useMemo(remembered, []);
  const flying = doc.helis.find(heli => heli.status === 'active') ?? doc.helis[0];
  const [mode, setMode] = useState<Mode>(saved.mode === 'widget' ? 'widget' : 'screen');
  const [logic, setLogic] = useState(saved.mode === 'logic');
  const [card, setCard] = useState<Card | null>(null);
  const [modelId, setModelId] = useState(saved.model ?? '');
  const [screenIndex, setScreenIndex] = useState(0);
  const [widgets, setWidgets] = useState<WidgetFile[]>([]);
  const [file, setFile] = useState(saved.file ?? 'armed-model.lua');
  const [zoneKey, setZoneKey] = useState(saved.zone ?? ZONES[0].key);
  const [heliId, setHeliId] = useState(saved.heli ?? flying?.id ?? '');
  const [built, setBuilt] = useState<{file: string; code: string; changed: number} | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{name: string; options: WidgetOption[]} | null>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [problem, setProblem] = useState('');
  const [ready, setReady] = useState(false);
  const [imageReady, setImageReady] = useState(0);
  const [manual, setManual] = useState<Record<string, number>>({});
  const [values, setValues] = useState<Record<string, number | string>>({});
  const [bindings, setBindings] = useState<Record<string, PackSignal | ''>>({});
  /** Which option each switch feeds, from the screen's widgets: SA is the ArmedModel's ArmedSwitch. */
  const [hints, setHints] = useState<Record<string, string>>({});
  const [asked, setAsked] = useState<string[]>([]);
  const [sounds, setSounds] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [packKey, setPackKey] = useState('');
  const [series, setSeries] = useState<TelemetrySeries | null>(null);
  const [replay, setReplay] = useState({at: 0, playing: false, speed: '1'});

  const heli = doc.helis.find(one => one.id === heliId);
  const zone = ZONES.find(one => one.key === zoneKey) ?? ZONES[0];
  const code = edited ?? built?.code ?? '';
  const model =
    card?.models.find(one => one.id === modelId) ??
    card?.models.find(one => one.name === 'M2 EVO') ??
    card?.models.find(one => one.screens.some(screen => screen.zones.length));
  const screen = model?.screens[Math.min(screenIndex, (model?.screens.length ?? 1) - 1)];

  // The model's logic in words, for the Logic view, with the radio's own.
  const logicView = useMemo(() => (model ? describeLogic(model, card?.radio) : null), [model, card?.radio]);

  // The model's timers as the radio runs them: from the start of each pack replayed, else on the clock.
  const timers = useMemo(
    () => (mode === 'screen' && model ? new ModelTimers(model, series ? 0 : null) : null),
    [mode, model, series],
  );

  // What the frame loop reads, always the latest.
  const live = useRef({
    manual,
    bindings,
    series,
    replay,
    placed: [] as Placed[],
    chrome: ALL_DECORATIONS as typeof ALL_DECORATIONS | null,
    sensors: [] as string[],
    hints: {} as Record<string, string>,
    outline: false,
    timers: null as ModelTimers | null,
    last: performance.now(),
  });
  live.current = {
    ...live.current,
    manual,
    bindings,
    series,
    chrome:
      mode === 'screen'
        ? (screen?.options ?? null)
        : {...ALL_DECORATIONS, flightMode: false, sliders: false, trims: false},
    sensors: mode === 'screen' ? (model?.sensors ?? []) : [],
    outline: mode === 'widget',
    timers,
  };

  const packs = useMemo(
    () =>
      [...doc.sorties]
        .filter(sortie => sortie.telemetry.length)
        .sort((left, right) => right.date.localeCompare(left.date))
        .flatMap(sortie => {
          const flights = groupPacks(sortie.telemetry);
          const name = doc.helis.find(one => one.id === sortie.heliId)?.name ?? 'A heli';
          return flights.map((pack, index) => ({
            key: `${sortie.id}:${index}`,
            sortie,
            pack,
            label: `${formatDay(sortie.date, {weekday: false, year: true})} · ${name}${flights.length > 1 ? ` · pack ${index + 1}` : ''}`,
          }));
        }),
    [doc.sorties, doc.helis],
  );
  const channels = packSignals(series);
  const duration = series?.time[series.time.length - 1] ?? 0;

  // A telemetry source reads as its sensor's name ("tele(5)" is VFAS on the M2 EVO), to find its channel in a pack.
  const sensorName = (source: string, sensors: string[]) => {
    const telemetry = /^tele\([-+]?(\d+)\)$/.exec(source);
    return telemetry ? (sensors[Number(telemetry[1])] ?? source) : source;
  };

  // A source at a moment of the pack replayed (now unless said), or as set by hand. It reads `live`, so the Lua and the
  // Logic view both see the latest.
  const valueAt = (asked: string, second?: number) => {
    const now = live.current;
    const source = sourceKey(asked);
    // A source set by hand stays so, even when the pack has a channel of its name.
    const bound = now.bindings[source];
    const channel = bound === undefined ? guessFor(source, now.sensors, now.hints, packSignals(now.series)) : bound;
    if (channel && now.series) return sourceValue(now.series, channel, second ?? now.replay.at);
    return now.manual[source] ?? restingValue(source);
  };

  // The model's logic (timers, logical switches) moved on to now: by the screen's timers and by the Logic view.
  const logicNow = () => {
    const {timers: running, series: replayed, replay: at} = live.current;
    running?.advance(
      replayed ? at.at : performance.now() / 1000,
      second => asked => valueAt(asked, replayed ? second : undefined),
    );
    return running;
  };

  // The radio and its Lua, once.
  useEffect(() => {
    if (!canvas.current) return;
    // One radio for the screen, even when React mounts the view twice (development): the Lua draws through it.
    if (!radio.current) {
      inputs.current = {
        value: asked => valueAt(asked),
        timer: index => {
          const running = logicNow();
          return running ? {value: running.value(index), start: running.start(index)} : {value: 0, start: 0};
        },
        model: {name: '', bitmap: ''},
      };
      radio.current = new Radio(canvas.current, inputs.current);
    }
    const made = radio.current;
    let current = true;
    const start = async () => {
      try {
        runner.current = await startLua(made);
        if (current) setReady(true);
      } catch (error) {
        if (current) setProblem(`The Lua engine did not start: ${message(error)}`);
      }
    };
    void start();
    return () => {
      current = false;
    };
  }, []);

  // The radio's card: every kept model's screens and logic, read from edge-tx by /api/radio.
  useEffect(() => {
    let current = true;
    const read = async () => {
      try {
        const response = await fetch('/api/radio', {cache: 'no-store'});
        if (!response.ok) throw new Error('no card');
        const read = (await response.json()) as Card;
        if (current) setCard(read);
      } catch {
        if (current) setCard({from: '', models: [], widgets: []});
      }
    };
    void read();
    return () => {
      current = false;
    };
  }, []);

  // The widgets built in edge-tx. While developing, a rebuild there shows here on its own.
  useEffect(() => {
    let current = true;
    const read = async () => {
      try {
        const list = await listWidgets();
        if (current) setWidgets(list);
      } catch {
        if (current) setWidgets([]);
      }
    };
    void read();
    const timer = import.meta.env.DEV ? window.setInterval(read, 1500) : undefined;
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, []);

  const shown = widgets.find(widget => widget.file === file) ?? widgets[0];
  useEffect(() => {
    if (!shown) return;
    let current = true;
    const read = async () => {
      try {
        const text = await widgetCode(shown.file);
        if (!current) return;
        setBuilt({file: shown.file, code: text, changed: shown.changed});
        setEdited(storedCode(shown.file));
        setDraft(null);
      } catch (error) {
        if (current) setProblem(message(error));
      }
    };
    void read();
    return () => {
      current = false;
    };
  }, [shown?.file, shown?.changed]);

  /** Puts a picture where the widgets open it, once: a model's own from the card, or a heli's cut-out photo. */
  const loadPicture = async (key: string, source: () => Promise<string | null>) => {
    const screenRadio = radio.current;
    if (!screenRadio || !key || screenRadio.images.has(key)) return;
    try {
      const url = await source();
      if (!url) return;
      const image = new Image();
      image.src = url;
      await image.decode();
      screenRadio.images.set(key, await createImageBitmap(image));
    } catch {
      // No picture: the widget gets nil, as on a radio without the file.
    }
  };

  // One widget: its model is a heli of the log, with its cut-out photo.
  useEffect(() => {
    if (mode !== 'widget' || !inputs.current) return;
    inputs.current.model = {name: heli ? radioName(heli.name) : 'Model', bitmap: heli?.photo ? `heli-${heli.id}` : ''};
    let current = true;
    const photo = heli?.photo;
    void loadPicture(heli ? `heli-${heli.id}` : '', async () => (photo ? ((await cutout(photo)) ?? photo) : null)).then(
      () => current && setImageReady(count => count + 1),
    );
    return () => {
      current = false;
    };
  }, [mode, heli?.id, heli?.name, heli?.photo]);

  /** Takes the widgets off the screen, before others go on it. */
  const clearScreen = () => {
    for (const item of live.current.placed) if (item.kind === 'lua') runner.current?.drop(item.id);
    live.current.placed = [];
    radio.current?.resetBitmaps();
    radio.current?.asked.clear();
    setAsked([]);
    live.current.hints = {};
    setHints({});
  };

  // One widget: (re)started on new code, a new zone or a new model.
  useEffect(() => {
    const lua = runner.current;
    const screenRadio = radio.current;
    if (mode !== 'widget' || !ready || !lua || !screenRadio || !code || !shown) return;
    clearScreen();
    try {
      const key = `edge-tx:${shown.file}`;
      const widget = lua.load(key, code);
      const full = zone.width >= SCREEN.width;
      const rect = full
        ? {x: 0, y: 0, w: zone.width, h: zone.height}
        : {x: VIEW.x, y: VIEW.y, w: zone.width, h: zone.height};
      const declared = widget.options.map(option => ({
        type: option.type === 'source' ? 'Source' : 'Signed',
        value: option.type === 'source' ? option.name : (values[option.name] ?? option.initial),
      }));
      lua.create('single', key, rect.w, rect.h, optionLines(screenRadio, widget.options, declared));
      const item: Placed = {id: 'single', widget: widget.name, rect, kind: 'lua', key, options: declared};
      live.current.placed = [item];
      setPlaced([item]);
      setLoaded(widget);
      setProblem('');
    } catch (error) {
      setProblem(message(error));
    }
    // Option changes go through update, below.
  }, [mode, ready, code, zone.width, zone.height, imageReady]);

  useEffect(() => {
    if (mode !== 'widget' || !loaded || problem || !radio.current) return;
    try {
      const declared = loaded.options.map(option => ({
        type: option.type === 'source' ? 'Source' : option.type === 'string' ? 'String' : 'Signed',
        value: option.type === 'source' ? option.name : (values[option.name] ?? option.initial),
      }));
      runner.current?.update('single', optionLines(radio.current, loaded.options, declared));
    } catch (error) {
      setProblem(message(error));
    }
  }, [values]);

  // Model screens: every zone of the chosen screen, and the top bar, with its widget.
  useEffect(() => {
    const lua = runner.current;
    const screenRadio = radio.current;
    if (mode !== 'screen' || !ready || !lua || !screenRadio || !card || !model) return;
    let current = true;
    const setUp = async () => {
      clearScreen();
      inputs.current!.model = {name: model.name, bitmap: model.bitmap, globals: model.globals};
      await loadPicture(model.bitmap, async () => radioFile(`IMAGES/${model.bitmap}`));
      const next: Placed[] = [];
      const readers: Record<string, string> = {};
      for (const {rect, zone: slot, id} of placeScreen(model, screenIndex)) {
        const base = {id, widget: slot.widget, rect, options: slot.options};
        if (isBuiltin(slot.widget)) {
          next.push({...base, kind: 'builtin'});
          continue;
        }
        const loading = loadCardWidget(card, slot.widget, lua, screenRadio);
        if (!loading) {
          next.push({...base, kind: 'missing', problem: 'Not on the card'});
          continue;
        }
        try {
          const widget = await loading;
          lua.create(id, widget.key, rect.w, rect.h, optionLines(screenRadio, widget.options, slot.options));
          widget.options.forEach((option, index) => {
            const given = slot.options[index];
            if (option.type === 'source' && given?.type === 'Source' && given.value) {
              readers[sourceKey(String(given.value))] = option.name;
            }
          });
          next.push({...base, kind: 'lua', key: widget.key});
        } catch (error) {
          next.push({...base, kind: 'missing', problem: message(error)});
        }
      }
      if (!current) return;
      live.current.placed = next;
      live.current.hints = readers;
      setHints(readers);
      setPlaced(next);
      setProblem('');
    };
    void setUp();
    return () => {
      current = false;
    };
  }, [mode, ready, card, model?.id, screenIndex]);

  // An edit runs half a second after the typing stops, and is kept in this browser.
  useEffect(() => {
    if (draft === null || !built) return;
    const timer = window.setTimeout(() => {
      const next = draft === built.code ? null : draft;
      setEdited(next);
      storeCode(built.file, next);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draft, built]);

  // The screen, 20 times a second, as the radio refreshes its widgets.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const screenRadio = radio.current;
      const lua = runner.current;
      if (!screenRadio) return;
      const now = performance.now();
      const state = live.current;
      if (state.replay.playing && state.series) {
        const end = state.series.time[state.series.time.length - 1] ?? 0;
        const at = Math.min(end, state.replay.at + ((now - state.last) / 1000) * Number(state.replay.speed));
        state.replay = {...state.replay, at, playing: at < end};
      }
      state.last = now;

      const {context} = screenRadio;
      drawChrome(context, state.chrome);
      if (state.outline) {
        context.save();
        context.fillStyle = '#a0a0a0';
        context.font = '500 14px Roboto, Arial, sans-serif';
        context.textBaseline = 'middle';
        context.fillText(inputs.current?.model.name ?? '', 54, TOP_BAR / 2);
        context.restore();
      }
      for (const item of state.placed) {
        screenRadio.zone = {...item.rect};
        if (item.kind === 'lua' && lua && !item.problem) {
          try {
            lua.refresh(item.id);
          } catch (error) {
            item.problem = message(error);
            if (item.id === 'single') setProblem(item.problem);
          }
        } else if (item.kind === 'builtin') {
          drawBuiltin(screenRadio, item, inputs.current?.model ?? {name: '', bitmap: ''});
        }
        if (item.kind === 'missing' || (item.problem && item.id !== 'single')) drawMissing(screenRadio, item);
        if (state.outline) {
          context.save();
          context.setLineDash([3, 3]);
          context.strokeStyle = 'rgba(124, 255, 178, 0.45)';
          context.strokeRect(item.rect.x - 0.5, item.rect.y - 0.5, item.rect.w + 1, item.rect.h + 1);
          context.restore();
        }
      }
      setReplay(state.replay);
      setSounds(previous => (previous.join() === screenRadio.sounds.join() ? previous : screenRadio.sounds));
      setAsked(previous => (previous.length === screenRadio.asked.size ? previous : [...screenRadio.asked]));
    }, 50);
    return () => window.clearInterval(timer);
  }, []);

  const choosePack = async (key: string) => {
    setPackKey(key);
    const chosen = packs.find(one => one.key === key);
    if (!chosen) {
      setSeries(null);
      live.current.replay = {...live.current.replay, at: 0, playing: false};
      return;
    }
    if (chosen.sortie.heliId) setHeliId(chosen.sortie.heliId);
    const parts = await Promise.all(chosen.pack.files.map(one => loadSeries(one.id).catch(() => null)));
    if (parts.some(part => !part)) {
      setProblem('The samples of this pack could not be read.');
      return;
    }
    setSeries(joinSeries(chosen.pack, parts as TelemetrySeries[]));
    live.current.replay = {...live.current.replay, at: 0, playing: true};
  };

  const setReplayState = (change: Partial<typeof replay>) => {
    live.current.replay = {...live.current.replay, ...change};
    setReplay(live.current.replay);
  };

  const download = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([code], {type: 'text/plain'}));
    link.download = 'main.lua';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const sensors = mode === 'screen' ? (model?.sensors ?? []) : [];
  const sourceOptions = mode === 'widget' ? (loaded?.options.filter(option => option.type === 'source') ?? []) : [];
  const otherOptions = mode === 'widget' ? (loaded?.options.filter(option => option.type !== 'source') ?? []) : [];
  const optionNames = new Set(sourceOptions.map(option => option.name));
  const readByName = [...new Set(asked.map(sourceKey))].filter(name => name && !optionNames.has(name)).sort();
  const sources = [...sourceOptions.map(option => option.name), ...readByName];
  const switches = sources.filter(isSwitch);
  const others = sources.filter(name => !isSwitch(name));
  // Model screens: the radio's eight switches where they sit, and any other a widget reads after them. One widget: the
  // switches it takes as options, shared between the sides.
  const physical = [...SIDES.left, ...SIDES.right];
  const loose = switches.filter(name => !physical.includes(name));
  const side =
    mode === 'screen'
      ? {
          left: [...SIDES.left, ...loose.filter((_name, index) => index % 2 === 0)],
          right: [...SIDES.right, ...loose.filter((_name, index) => index % 2 === 1)],
        }
      : {
          left: switches.filter((_name, index) => index % 2 === 0),
          right: switches.filter((_name, index) => index % 2 === 1),
        };
  // Dimmed: a switch the model uses nowhere (on any screen, in a mix, a logical switch, a sound...); for a card read
  // before Flightdown knew that, one no widget on this screen reads.
  const isUnused = (name: string) =>
    mode === 'screen' && !(model?.switches ? model.switches.includes(name) : switches.includes(name));
  // A source now: what the pack replayed gives it, else what was set by hand, else where it rests.
  const sourceNow = (name: string) => {
    const followed = bindings[name] ?? guessFor(name, sensors, hints, channels);
    return {
      followed,
      value: followed && series ? sourceValue(series, followed, replay.at) : (manual[name] ?? restingValue(name)),
    };
  };
  // The 6-position buttons, under the screen as on the radio: always on a model screen, else when the widget reads them.
  const showButtons = mode === 'screen' || sources.includes('6P');
  const buttons = sourceNow('6P');
  const folded = others.filter(name => name !== '6P' || !showButtons);
  const pressed = buttonOf(buttons.value);
  const pressButton = (button: number) => {
    setBindings(previous => ({...previous, '6P': ''}));
    setManual(previous => ({...previous, '6P': buttonValue(button)}));
  };
  const control = (name: string, unused = false) => {
    const sensor = sensorName(name, sensors);
    const {followed, value} = sourceNow(name);
    return (
      <SourceControl
        key={name}
        name={name}
        unused={unused}
        label={sensor === name ? name : `${name} · ${sensor}`}
        hint={hints[name]}
        role={mode === 'screen' ? switchRole(model?.name, name) : undefined}
        packSignal={guessSignal(name, channels) || (hints[name] && guessSignal(hints[name], channels)) || 'running'}
        value={value}
        onChange={value => setManual(previous => ({...previous, [name]: value}))}
        channel={followed}
        channels={channels}
        onBind={channel => setBindings(previous => ({...previous, [name]: channel}))}
      />
    );
  };
  const chooseMode = (next: Shown) => {
    setMode(next === 'widget' ? 'widget' : 'screen');
    setLogic(next === 'logic');
    remember('mode', next);
    setProblem('');
  };

  // The Logic view: what is on now, where each control sits, the timers and the outputs a replay logged.
  const showLogic = logic && mode === 'screen' && logicView !== null;
  const isOnNow = (when: string) =>
    when === 'TX_BATTERY_LOW'
      ? valueAt('TX_VOLTAGE') < (card?.radio?.batteryWarning ?? 0)
      : (logicNow()?.isOn(when) ?? false);
  const whereNow = (control: string) => {
    if (/^S[A-H]$/.test(control)) return positionOf(valueAt(control));
    if (control === '6P') return `button ${buttonOf(valueAt('6P'))}`;
    if (['S1', 'S2', 'LS', 'RS'].includes(control)) return `${Math.round(valueAt(control) / 10.24)}%`;
    if (control === 'telemetry') return isOnNow('TELEMETRY_STREAMING') ? 'coming in' : 'none';
    return '';
  };
  const outputNow = (channel: number) =>
    series?.channels[`ch${channel}`]?.length ? Math.round(1500 + valueAt(`ch(${channel - 1})`) / 2) : null;

  const optionTile = (option: WidgetOption) => (
    <label key={option.name} className="radio-input">
      <span className="radio-input-name">{option.name}</span>
      {option.type === 'bool' ? (
        <input
          type="checkbox"
          checked={Number(values[option.name] ?? option.initial) === 1}
          onChange={event => setValues(previous => ({...previous, [option.name]: event.target.checked ? 1 : 0}))}
        />
      ) : option.type === 'color' ? (
        <input
          type="color"
          className="radio-color"
          onChange={event =>
            setValues(previous => ({...previous, [option.name]: parseInt(event.target.value.slice(1), 16)}))
          }
        />
      ) : (
        <input
          className="input"
          type={option.type === 'value' ? 'number' : 'text'}
          value={values[option.name] ?? option.initial}
          onChange={event =>
            setValues(previous => ({
              ...previous,
              [option.name]: option.type === 'value' ? Number(event.target.value) : event.target.value,
            }))
          }
        />
      )}
    </label>
  );
  const where = (item: Placed) => (item.id.startsWith('top') ? 'top bar' : `zone ${item.id.replace('zone-', '')}`);
  const how = (item: Placed) =>
    item.kind === 'lua'
      ? item.problem
        ? 'Lua, failed'
        : 'Lua from the card'
      : item.kind === 'builtin'
        ? "EdgeTX's own, redrawn"
        : (item.problem ?? '');

  return (
    <div className="radio-view">
      <div className="radio-console">
        <div className="radio-switches left" aria-label="Left switches">
          {side.left.map(name => control(name, isUnused(name)))}
        </div>
        <div className="radio-screen">
          <canvas ref={canvas} width={SCREEN.width} height={SCREEN.height} aria-label="The radio's screen" />
          {showButtons && (
            <div
              className={['radio-buttons', buttons.followed && 'from-pack'].filter(Boolean).join(' ')}
              role="group"
              aria-label="6-position buttons"
            >
              {BUTTONS.map(button => {
                const pack = buttonPack(button, doc.batteries);
                return (
                  <button
                    key={button}
                    type="button"
                    className="radio-button"
                    aria-pressed={pressed === button}
                    aria-label={`Button ${button}${pack ? `: ${pack}` : ''}`}
                    title={pack ?? `Button ${button}`}
                    onClick={() => pressButton(button)}
                  >
                    {button}
                  </button>
                );
              })}
              <span className="radio-buttons-pack">
                {buttonPack(pressed, doc.batteries) ?? `Button ${pressed}`}
                {buttons.followed && series ? ', from the pack' : ''}
              </span>
            </div>
          )}
        </div>
        <div className="radio-switches right" aria-label="Right switches">
          {side.right.map(name => control(name, isUnused(name)))}
        </div>
      </div>

      <div className="radio-bar">
        <Segmented<Shown>
          label="Show"
          value={mode === 'widget' ? 'widget' : logic ? 'logic' : 'screen'}
          onChange={chooseMode}
          options={[
            {value: 'screen', label: 'Model screens'},
            {value: 'logic', label: 'Logic'},
            {value: 'widget', label: 'One widget'},
          ]}
        />
        {mode === 'screen' ? (
          <>
            <select
              className="input"
              aria-label="Model"
              value={model?.id ?? ''}
              onChange={event => {
                setModelId(event.target.value);
                setScreenIndex(0);
                remember('model', event.target.value);
              }}
            >
              {card?.models.map(one => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
            {model && model.screens.length > 1 && (
              <Segmented
                label="Screen"
                value={String(screenIndex)}
                onChange={value => setScreenIndex(Number(value))}
                options={model.screens.map((_page, index) => ({value: String(index), label: `Screen ${index + 1}`}))}
              />
            )}
          </>
        ) : (
          <>
            <select
              className="input"
              aria-label="Widget"
              value={shown?.file ?? ''}
              onChange={event => {
                setFile(event.target.value);
                remember('file', event.target.value);
                setValues({});
              }}
            >
              {widgets.map(widget => (
                <option key={widget.file} value={widget.file}>
                  {widget.name}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label="Zone"
              value={zone.key}
              onChange={event => {
                setZoneKey(event.target.value);
                remember('zone', event.target.value);
              }}
            >
              {ZONES.map(one => (
                <option key={one.key} value={one.key}>
                  {one.label} ({one.width} × {one.height})
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label="Model"
              value={heliId}
              onChange={event => {
                setHeliId(event.target.value);
                remember('heli', event.target.value);
              }}
            >
              {doc.helis.map(one => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </>
        )}
        <span className="radio-bar-end">
          {mode === 'widget' && edited !== null && <span className="pill caution">Edited here</span>}
          <button
            type="button"
            className="button small ghost"
            onClick={() => {
              radio.current?.pause(!paused);
              setPaused(!paused);
            }}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />} {paused ? 'Run' : 'Freeze'}
          </button>
        </span>
      </div>
      {problem && <pre className="radio-problem">{problem}</pre>}

      <div className="radio-replay">
        {packs.length ? (
          <>
            <select
              className="input"
              aria-label="Pack to replay"
              value={packKey}
              onChange={event => void choosePack(event.target.value)}
            >
              <option value="">Replay a pack…</option>
              {packs.map(one => (
                <option key={one.key} value={one.key}>
                  {one.label}
                </option>
              ))}
            </select>
            {series && (
              <>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={replay.playing ? 'Pause the pack' : 'Play the pack'}
                  onClick={() => setReplayState({playing: !replay.playing, at: replay.at >= duration ? 0 : replay.at})}
                >
                  {replay.playing ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={replay.at}
                  onChange={event => setReplayState({at: Number(event.target.value)})}
                  aria-label="Moment of the pack"
                />
                <span className="radio-value">
                  {formatTimer(replay.at)} / {formatTimer(duration)}
                </span>
                <Segmented
                  label="Speed"
                  value={replay.speed}
                  onChange={speed => setReplayState({speed})}
                  options={SPEEDS.map(speed => ({value: speed, label: `${speed}×`}))}
                />
              </>
            )}
          </>
        ) : (
          <span className="muted">No radio log yet: add one to a sortie to replay it here.</span>
        )}
      </div>

      {/* The logic under the screen and the replay, the whole width: flip a switch or play a pack and watch both. */}
      {showLogic && (
        <RadioLogic
          view={logicView}
          isOn={isOnNow}
          where={whereNow}
          ways={waysOf}
          timer={index => logicNow()?.value(index) ?? 0}
          output={outputNow}
        />
      )}

      {(folded.length > 0 || otherOptions.length > 0) && (
        <details className="radio-more">
          <summary>Sticks, outputs, sensors and settings · {folded.length + otherOptions.length}</summary>
          <div className="radio-grid">
            {folded.map(name => control(name))}
            {otherOptions.map(optionTile)}
          </div>
        </details>
      )}

      {mode === 'screen' ? (
        <details className="radio-more">
          <summary>On this screen · {plural(placed.length, 'widget')}</summary>
          {placed.length ? (
            <div className="radio-placed">
              {placed.map(item => (
                <div key={item.id} className="radio-placed-row">
                  <b>{item.widget}</b>
                  <span className="muted">{where(item)}</span>
                  <span className="muted tabular">
                    {item.rect.w} × {item.rect.h}
                  </span>
                  <span className="muted">{how(item)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">{model ? 'No widget on this screen.' : 'The card did not load from edge-tx.'}</div>
          )}
          {card?.from && <p className="caption">Read from {card.from}.</p>}
        </details>
      ) : (
        <Panel
          label="Lua"
          note={
            edited !== null
              ? 'Edited here, kept in this browser. Its source is the TypeScript in edge-tx.'
              : 'As built in edge-tx: edit it to try a change.'
          }
          action={
            <span className="toolbar">
              {edited !== null && (
                <button
                  type="button"
                  className="button small ghost"
                  onClick={() => {
                    setDraft(null);
                    setEdited(null);
                    if (built) storeCode(built.file, null);
                  }}
                >
                  <RotateCcw size={14} /> Built one
                </button>
              )}
              <button type="button" className="button small" onClick={download} disabled={!code}>
                <Download size={14} /> main.lua
              </button>
            </span>
          }
        >
          <textarea
            className="input radio-code"
            value={draft ?? code}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Tab') return;
              event.preventDefault();
              const area = event.currentTarget;
              const {selectionStart, selectionEnd, value} = area;
              const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
              setDraft(next);
              requestAnimationFrame(() => area.setSelectionRange(selectionStart + 2, selectionStart + 2));
            }}
            aria-label="The widget's Lua"
          />
          <p className="caption">
            On the radio it goes in WIDGETS/{shown?.name ?? 'the widget'}/main.lua (its folder may have another name).
          </p>
        </Panel>
      )}

      {sounds.length > 0 && <p className="radio-sounds">Played: {sounds.join(' · ')}</p>}
    </div>
  );
}
