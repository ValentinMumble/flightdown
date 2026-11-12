/**
 * The radio's SD card as the Radio tab reads it: each model's screens (layout, widgets in their zones, their options)
 * and top bar, its logic, the Lua widgets those screens use, and the model pictures. /api/radio reads it from
 * edge-tx's sd-card/ (api/_lib/edgetx.ts).
 */
import type {LogicalSwitch, ModelTimer} from './timers';

/** A widget option as the model file keeps it: a source ("SA", "tele(6)"), a number, a colour, some text. */
export interface CardOption {
  type: string;
  value: number | string;
}

export interface CardZone {
  index: number;
  widget: string;
  options: CardOption[];
}

export interface LayoutOptions {
  topbar: boolean;
  flightMode: boolean;
  sliders: boolean;
  trims: boolean;
  mirrored: boolean;
}

export interface CardScreen {
  layout: string;
  options: LayoutOptions;
  zones: CardZone[];
}

/** A curve a line uses: type 3 is a custom curve (value its number from 1), type 1 an expo (value the %). */
export interface CurveRef {
  type: number;
  value: number;
}

/** An input line: a stick or source through its weight and curve, before the mixes (I3 Thr). */
export interface CardInput {
  input: number;
  source: string;
  weight: number;
  swtch: string;
  curve?: CurveRef;
}

/** A mix line, in the order the radio applies them: added to its channel, or replacing it while its switch is on. */
export interface CardMix {
  channel: number;
  source: string;
  weight: number;
  offset: number;
  swtch: string;
  curve?: CurveRef;
  /** ADD, MULT or REPL. */
  how: string;
  name: string;
}

/** A special function (or a global one, on the radio): on its switch, PLAY_TRACK "armed,1,1x" says "armed" once. */
export interface CardFunction {
  swtch: string;
  func: string;
  def: string;
}

/** What the radio does for every model: its global functions, and the warning on its own battery (volts). */
export interface CardRadio {
  functions: CardFunction[];
  batteryWarning?: number;
}

export interface CardModel {
  /** Its file on the card: model20. */
  id: string;
  name: string;
  bitmap: string;
  screens: CardScreen[];
  topbar: CardZone[];
  /** How many top bar slots each top bar widget spans. */
  topbarWidths: number[];
  /** Telemetry sensor names by index: a "tele(5)" source reads sensors[5]. */
  sensors: string[];
  /** The switches the model uses anywhere: mixes, inputs, logical switches, special functions, timers, widgets. */
  switches: string[];
  /** Its global variables in the first flight mode, by index, those not 0: GV6 (index 5) is 3 cells for mAhRe. */
  globals?: Record<number, number>;
  /** Telemetry sensor precisions by index: Curr (precision 1) is kept in tenths of an amp. */
  precisions?: number[];
  /** Its timers, the logical switches they may run on (by index, L1 is 0), and the special functions resetting them. */
  timers?: ModelTimer[];
  logicalSwitches?: Record<number, LogicalSwitch>;
  timerResets?: {swtch: string; timer: number}[];
  /** Its inputs' names by index (Thr is input 3), its input and mix lines, special functions and curve names. */
  inputNames?: string[];
  inputs?: CardInput[];
  mixes?: CardMix[];
  functions?: CardFunction[];
  curveNames?: string[];
}

/** A Lua widget on the card: the name it registers, its folder in WIDGETS/, and its files there. */
export interface CardWidget {
  name: string;
  folder: string;
  files: string[];
  /** Replaced by the one built in edge-tx, as it goes on the radio next. */
  fromEdgeTx?: boolean;
}

export interface Card {
  /** Where it was read: the card itself or a backup of it. */
  from: string;
  models: CardModel[];
  widgets: CardWidget[];
  radio?: CardRadio;
}

/** EdgeTX's own widgets (in its firmware, not Lua on the card): the Radio tab redraws them. */
export const EDGETX_WIDGETS = [
  'ModelBmp',
  'Model Name',
  'Timer',
  'Value',
  'Text',
  'Outputs',
  'Gauge',
  'Radio Info',
  'Date Time',
];

type Yaml = Record<string, unknown>;

const record = (value: unknown): Yaml =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Yaml) : {};

/** A YAML map with number keys (EdgeTX's lists: "0:", "1:") as its entries in order; a real list (mixData) too. */
const entries = (value: unknown) =>
  Array.isArray(value)
    ? value.map((item: unknown, index) => [index, item] as const)
    : Object.entries(record(value))
        .map(([key, item]) => [Number(key), item] as const)
        .filter(([key]) => Number.isFinite(key))
        .sort(([left], [right]) => left - right);

function option(value: unknown): CardOption {
  const item = record(value);
  const typed = record(item.value);
  const first = Object.values(typed)[0];
  return {type: String(item.type ?? ''), value: typeof first === 'number' ? first : String(first ?? '')};
}

function zones(value: unknown): CardZone[] {
  return entries(value)
    .map(([index, zone]) => {
      const data = record(zone);
      return {
        index,
        widget: String(data.widgetName ?? ''),
        options: entries(record(data.widgetData).options).map(([, item]) => option(item)),
      };
    })
    .filter(zone => zone.widget);
}

/**
 * The switches a model uses, from every value of its file ("SA", "SF0", "!SA0", "SE,0" in a logical switch), but the
 * power-on checks, which list them all.
 */
export function usedSwitches(data: Yaml): string[] {
  const found = new Set<string>();
  const walk = (value: unknown, key: string) => {
    if (key === 'switchWarning' || key === 'header' || key === 'telemetrySensors') return;
    if (typeof value === 'string') {
      for (const match of value.matchAll(/(?<![A-Za-z])S([A-H])[0-2]?(?![A-Za-z])/g)) found.add(`S${match[1]}`);
    } else if (value && typeof value === 'object') {
      for (const [inner, item] of Object.entries(value)) walk(item, inner);
    }
  };
  walk(data, '');
  return [...found].sort();
}

/** A line's curve, when it has one. */
function curveOf(value: unknown): {curve?: CurveRef} {
  const curve = record(value);
  return Number(curve.value) ? {curve: {type: Number(curve.type) || 0, value: Number(curve.value)}} : {};
}

/** The special functions (or global ones) that do something: those with a function set. */
function functionsOf(value: unknown): CardFunction[] {
  return entries(value)
    .map(([, item]) => record(item))
    .filter(item => item.func)
    .map(item => ({swtch: String(item.swtch ?? 'NONE'), func: String(item.func), def: String(item.def ?? '')}));
}

/** The radio's own settings file (RADIO/radio.yml): its global functions and its battery warning. */
export function readRadio(data: Yaml): CardRadio {
  const warning = Number(data.vBatWarn);
  return {functions: functionsOf(data.customFn), ...(warning ? {batteryWarning: warning / 10} : {})};
}

/** One model file (model20.yml), read with a YAML parser. */
export function readModel(id: string, data: Yaml): CardModel {
  const header = record(data.header);
  const screens = entries(data.screenData).map(([, screen]) => {
    const layout = record(record(screen).layoutData);
    const flags = entries(layout.options).map(([, item]) => Number(option(item).value) === 1);
    return {
      layout: String(record(screen).LayoutId ?? 'Layout1x1'),
      options: {
        topbar: flags[0] ?? true,
        flightMode: flags[1] ?? true,
        sliders: flags[2] ?? true,
        trims: flags[3] ?? true,
        mirrored: flags[4] ?? false,
      },
      zones: zones(layout.zones),
    };
  });
  const widths = entries(data.topbarWidgetWidth).map(([, width]) => Number(width) || 1);
  return {
    id,
    name: String(header.name ?? id),
    bitmap: String(header.bitmap ?? ''),
    screens,
    topbar: zones(record(data.topbarData).zones),
    topbarWidths: widths,
    // At their own index, gaps kept: a "tele(5)" source is sensor 5 whatever comes before it.
    sensors: entries(data.telemetrySensors).reduce<string[]>((list, [index, sensor]) => {
      list[index] = String(record(sensor).label ?? '');
      return list;
    }, []),
    precisions: entries(data.telemetrySensors).reduce<number[]>((list, [index, sensor]) => {
      list[index] = Number(record(sensor).prec) || 0;
      return list;
    }, []),
    switches: usedSwitches(data),
    timers: entries(data.timers).map(([, timer]) => ({
      start: Number(record(timer).start) || 0,
      swtch: String(record(timer).swtch ?? 'NONE'),
      mode: String(record(timer).mode ?? 'OFF'),
    })),
    logicalSwitches: Object.fromEntries(
      entries(data.logicalSw).map(([index, item]) => {
        const logical = record(item);
        const field = (key: string, fallback: string) => String(logical[key] ?? fallback);
        return [
          index,
          {
            func: field('func', ''),
            def: field('def', ''),
            andsw: field('andsw', 'NONE'),
            delay: Number(logical.delay) || 0,
          },
        ];
      }),
    ),
    // "RESET" with "Tmr1,1": timer 1 starts again while its switch is on.
    timerResets: entries(data.customFn).flatMap(([, item]) => {
      const special = record(item);
      const timer = /^Tmr(\d)/.exec(String(special.def ?? ''));
      return special.func === 'RESET' && timer
        ? [{swtch: String(special.swtch ?? 'NONE'), timer: Number(timer[1]) - 1}]
        : [];
    }),
    inputNames: entries(data.inputNames).reduce<string[]>((list, [index, item]) => {
      list[index] = String(record(item).val ?? '');
      return list;
    }, []),
    inputs: entries(data.expoData).map(([, item]) => {
      const line = record(item);
      return {
        input: Number(line.chn) || 0,
        source: String(line.srcRaw ?? ''),
        weight: Number(line.weight ?? 100),
        swtch: String(line.swtch ?? 'NONE'),
        ...curveOf(line.curve),
      };
    }),
    mixes: entries(data.mixData).map(([, item]) => {
      const line = record(item);
      return {
        channel: Number(line.destCh) || 0,
        source: String(line.srcRaw ?? ''),
        weight: Number(line.weight ?? 100),
        offset: Number(line.offset) || 0,
        swtch: String(line.swtch ?? 'NONE'),
        ...curveOf(line.curve),
        how: String(line.mltpx ?? 'ADD'),
        name: String(line.name ?? ''),
      };
    }),
    functions: functionsOf(data.customFn),
    curveNames: entries(data.curves).reduce<string[]>((list, [index, item]) => {
      list[index] = String(record(item).name ?? '');
      return list;
    }, []),
    globals: Object.fromEntries(
      entries(record(record(entries(data.flightModeData)[0]?.[1]).gvars))
        .map(([index, variable]) => [index, Number(record(variable).val) || 0])
        .filter(([, value]) => value !== 0),
    ),
  };
}

/**
 * The name a Lua widget registers under: the `name` of the table it returns (`return {name = "BattAnalog", ...}` or
 * through a local), else its first `name = "..."`.
 */
export function registeredName(source: string): string | null {
  // Comments out (a widget may keep an old `return {...}` commented above the real one), then the last return.
  const code = source.replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '').replace(/--[^\n]*/g, '');
  const returns = [...code.matchAll(/return\s*\{[\s\S]*?\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_]\w*))/g)];
  const returned = returns[returns.length - 1];
  if (returned?.[1] || returned?.[2]) return returned[1] ?? returned[2];
  if (returned?.[3] && returned[3] !== 'name') {
    const local = new RegExp(`\\b${returned[3]}\\s*=\\s*["']([^"']+)["']`).exec(code);
    if (local) return local[1];
  }
  return (
    /^local name\s*=\s*["']([^"']+)["']/m.exec(code)?.[1] ?? /\bname\s*=\s*["']([^"']+)["']/.exec(code)?.[1] ?? null
  );
}
