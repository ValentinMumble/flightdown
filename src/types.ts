/** The data of a flight log: everything Flightdown keeps, shared by the page and the API routes. */

export type HeliStatus = 'active' | 'grounded' | 'sold' | 'lost' | 'retired';

export interface Heli {
  id: string;
  /** As written in the log, emoji included ("M2 EVO 🟠"): two of the same model are two helis. */
  name: string;
  maker?: string;
  model?: string;
  /** Its slot in the chart palette (0 to 7): the heli keeps its colour in every chart. */
  color: number;
  status: HeliStatus;
  /** Day it was bought (YYYY-MM-DD), else its first sortie's. */
  acquired?: string;
  /** What it cost, in euros. */
  price?: number;
  /** Flight time of one pack, in seconds: the next sortie starts with it. */
  timer?: number;
  /** The packs it flies on, in words ("3S 450 mAh"). */
  battery?: string;
  /** Flybarless gains, channel map, anything about its setup. */
  setup?: string;
  /** A link to a picture of it. */
  photo?: string;
  createdAt: string;
}

export interface Spot {
  id: string;
  name: string;
  emoji?: string;
  notes?: string;
  /** Where it is, in degrees (WGS 84, as GPS gives them). */
  lat?: number;
  lng?: number;
}

export interface BrokenPart {
  part: string;
  qty: number;
  /** "fixed on site", anything said about it. */
  note?: string;
}

/** What one EdgeTX log says, kept with its sortie. Its samples are stored apart (see TelemetrySeries). */
export interface TelemetryLog {
  id: string;
  /** The file it came from. */
  name: string;
  /** When the log starts (local time, YYYY-MM-DDTHH:MM:SS). */
  start?: string;
  /** Seconds from the first to the last sample. */
  duration: number;
  samples: number;
  /** Capacity used, from the Capa sensor or the current over time. */
  mAh?: number;
  minVoltage?: number;
  maxCurrent?: number;
  avgCurrent?: number;
  minRssi?: number;
  /** The 6-position button pressed through the log (1 to 6): which pack it was, when packs are given buttons. */
  packButton?: number;
  /** Seconds with the motor on (CH3 off cut, else drawing 2 A or more): the time in the air, as the PACK timer's. */
  flying?: number;
  /** Seconds upside down: the collective held past the other side of hover under load (see invertedStretches). */
  inverted?: number;
  /** The pack's resistance (mΩ, the whole pack) from the voltage drop when the current jumps: it climbs with age. */
  resistance?: number;
}

/** A log's samples, thinned to a few hundred points: seconds from the start, and one list per sensor. */
export interface TelemetrySeries {
  id: string;
  time: number[];
  channels: Record<string, number[]>;
}

export interface Sortie {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  heliId: string;
  spotId?: string;
  packs: number;
  /** Flight time of one pack, in seconds; null when not known. */
  timer: number | null;
  /** null when not known ("?" in the sheet). */
  crashes: number | null;
  broken: BrokenPart[];
  /** Manoeuvres practised (see SKILLS). */
  skills: string[];
  notes: string;
  /** Photos, videos, a map. */
  links: string[];
  /**
   * Photos of the shared album (their ids) picked for this sortie. Left out, the sortie shows the album's photos taken
   * that day.
   */
  photos?: string[];
  telemetry: TelemetryLog[];
  /** When it was written down: spares in stock only count the parts broken after their count. */
  loggedAt: string;
}

export interface Spare {
  id: string;
  name: string;
  /** The heli it fits; none for a part that fits several. */
  heliId?: string;
  /** How many there were at countedAt: parts broken in sorties logged since then come off it. */
  count: number;
  countedAt: string;
  /** Below this, the part goes on the shopping list. */
  min: number;
  price?: number;
  url?: string;
}

/** One pack of a kind, for good: it keeps its number, and its logs and charts when it dies. */
export interface Pack {
  /** Its number in its kind, never given to another: "Gens Ace #3". */
  number: number;
  /** The radio's 6-position button it is picked with before a flight (1 to 6). */
  button?: number;
  /** The day it got that button (YYYY-MM-DD): a log on the button is this pack's from then on. */
  since?: string;
  /** The day it stopped holding a charge (YYYY-MM-DD): no longer flown, still counted. */
  dead?: string;
}

/** A kind of pack (one product), and its packs one by one. */
export interface Battery {
  id: string;
  name: string;
  cells: number;
  /** mAh */
  capacity: number;
  packs: Pack[];
  heliIds: string[];
  /** YYYY-MM-DD */
  bought?: string;
  notes?: string;
  /** A link to a photo of it, cut out of its white background as the helis' are. */
  photo?: string;
}

export interface Tip {
  id: string;
  title: string;
  body: string;
  heliId?: string;
}

/** Everything else in the hangar: the radio, a charger, a simulator. */
/** How a piece of gear left the hangar. */
export type GearGone = 'sold' | 'lost' | 'stolen';

export interface Gear {
  id: string;
  name: string;
  category: 'radio' | 'charger' | 'simulator' | 'other';
  /** Left out while it is still here. */
  gone?: GearGone;
  /** "4-in-1 module, AG01 Hall CNC gimbals". */
  details?: string;
  /** YYYY-MM-DD */
  since?: string;
  /** What it cost, in euros. */
  price?: number;
  notes?: string;
  /** A link to a photo of it, cut out of its white background as the helis' are. */
  photo?: string;
}

export interface Doc {
  helis: Heli[];
  spots: Spot[];
  sorties: Sortie[];
  spares: Spare[];
  batteries: Battery[];
  tips: Tip[];
  gear: Gear[];
}

export type Kind = keyof Doc;

export const KINDS: Kind[] = ['helis', 'spots', 'sorties', 'spares', 'batteries', 'tips', 'gear'];

export type Item<K extends Kind> = Doc[K][number];

/** A change to the log, as the page sends it to the server. */
export type Change =
  | {type: 'put'; kind: Kind; item: {id: string}}
  | {type: 'delete'; kind: Kind; id: string}
  | {type: 'replace'; doc: Doc; series: TelemetrySeries[]}
  | {type: 'telemetry'; series: TelemetrySeries};

export const emptyDoc = (): Doc => ({
  helis: [],
  spots: [],
  sorties: [],
  spares: [],
  batteries: [],
  tips: [],
  gear: [],
});
