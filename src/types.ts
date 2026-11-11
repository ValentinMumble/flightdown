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
  /** Day it joined the fleet (YYYY-MM-DD). */
  acquired?: string;
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

export interface Battery {
  id: string;
  name: string;
  cells: number;
  /** mAh */
  capacity: number;
  /** How many packs of this kind. */
  count: number;
  /** Of those, how many no longer hold a charge: still counted, no longer flown. */
  dead?: number;
  heliIds: string[];
  /** YYYY-MM-DD */
  bought?: string;
  notes?: string;
  /** A link to a photo of it, cut out of its white background as the helis' are. */
  photo?: string;
  /**
   * The radio's 6-position buttons its packs are picked with before a flight, one a pack ([3, 4]: its first pack on 3,
   * its second on 4), and the day that began (YYYY-MM-DD): a log names its pack from then on.
   */
  buttons?: number[];
  buttonsSince?: string;
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
