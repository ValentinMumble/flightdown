/**
 * The radio's SD card as the Radio tab reads it: each model's screens (layout, widgets in their zones, their options)
 * and top bar, the Lua widgets those screens use, and the model pictures. `npm run radio` writes it to
 * public/radio/card.json from the card or its latest backup.
 */

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

/** A YAML map with number keys (EdgeTX's lists: "0:", "1:") as its entries in order. */
const entries = (value: unknown) =>
  Object.entries(record(value))
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
    switches: usedSwitches(data),
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
