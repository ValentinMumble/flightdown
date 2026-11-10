import type {Heli, Sortie} from '../types';
import {partKey, WHOLE_HELI} from './parts';
import {SKILLS} from './skills';
import {airtime, sortSorties} from './stats';

/**
 * The stats only a heli pilot keeps: where the heli breaks, what brings it down, how far up the manoeuvre ladder
 * the pilot is, the life of each heli, the flying season, and the milestones of the log.
 */

/** The parts of a heli, as the damage map draws them. */
export const ZONES = [
  {key: 'blades', label: 'Main blades'},
  {key: 'head', label: 'Rotor head and links'},
  {key: 'shaft', label: 'Main shaft'},
  {key: 'servos', label: 'Servos'},
  {key: 'canopy', label: 'Canopy'},
  {key: 'frame', label: 'Frame and drive'},
  {key: 'boom', label: 'Tail boom'},
  {key: 'tail', label: 'Tail rotor and fin'},
  {key: 'skids', label: 'Landing gear'},
] as const;

export type Zone = (typeof ZONES)[number]['key'];

const ZONE_HINTS: [RegExp, Zone][] = [
  [/tail boom|\bboom\b/i, 'boom'],
  [/tail/i, 'tail'],
  [/servo/i, 'servos'],
  [/main shaft|\bmast\b/i, 'shaft'],
  [/grip/i, 'head'],
  [/blade/i, 'blades'],
  [/canopy|body|cockpit/i, 'canopy'],
  [/skid|landing|undercarriage/i, 'skids'],
  [/feathering|head|swash|link|ball|rod|jesus|grip|hub|anti-rotation|damper|spindle/i, 'head'],
  [/frame|gear|motor|esc|pinion|bearing|belt|board|fbl|receiver/i, 'frame'],
];

/** The zone a broken part belongs to; none for an unknown part or a whole heli. */
export function zoneOf(part: string): Zone | null {
  if (part === WHOLE_HELI) return null;
  return ZONE_HINTS.find(([pattern]) => pattern.test(part))?.[1] ?? null;
}

export interface ZoneTally {
  zone: Zone;
  qty: number;
  parts: Map<string, {name: string; qty: number}>;
}

/** Parts broken in each zone of the heli. */
export function damageByZone(sorties: Sortie[]) {
  const tallies = new Map<Zone, ZoneTally>(ZONES.map(({key}) => [key, {zone: key, qty: 0, parts: new Map()}]));
  let unplaced = 0;
  for (const sortie of sorties) {
    for (const broken of sortie.broken) {
      const zone = zoneOf(broken.part);
      if (!zone) {
        if (broken.part !== WHOLE_HELI) unplaced += broken.qty;
        continue;
      }
      const tally = tallies.get(zone)!;
      tally.qty += broken.qty;
      const key = partKey(broken.part);
      const part = tally.parts.get(key) ?? {name: broken.part, qty: 0};
      part.qty += broken.qty;
      tally.parts.set(key, part);
    }
  }
  return {zones: tallies, unplaced};
}

/** What brings a heli down, as the notes of a crash say it. */
export const CAUSES = [
  {key: 'thumb', label: 'Dumb thumb', icon: '👍', pattern: /dumb thumb|over-?confiden|wrong (way|stick)/i},
  {
    key: 'low',
    label: 'Too low',
    icon: '⬇️',
    pattern: /too low|undershoot|close to (the )?ground|not enough collective/i,
  },
  {key: 'overshoot', label: 'Overshot', icon: '↪️', pattern: /overshoot/i},
  {
    key: 'obstacle',
    label: 'Trees and obstacles',
    icon: '🌳',
    pattern: /tree|branch|bush|wall|fence|house|pole|net\b|case/i,
  },
  {key: 'wind', label: 'Wind', icon: '💨', pattern: /wind|gust/i},
  {
    key: 'sight',
    label: 'Lost sight or orientation',
    icon: '☀️',
    pattern: /\bsun\b|lost it|orientation|towards me|scared/i,
  },
  {
    key: 'failure',
    label: 'Something failed',
    icon: '🔩',
    pattern:
      /broke in mid-?air|stopped responding|on its own|popped|stripped|came off|failed\b|weird|stops with|slows down/i,
  },
  {key: 'power', label: 'Battery', icon: '🪫', pattern: /battery|pack (died|cut)|ran flat|low voltage|exhausted/i},
  {
    key: 'learning',
    label: 'Pushing a new manoeuvre',
    icon: '🎯',
    pattern: /practi[cs]|trying|almost achieving|hurrican|inverted|funnel|loop/i,
  },
  {key: 'goggles', label: 'Goggles on', icon: '🥽', pattern: /goggles|\bfpv\b/i},
  {key: 'newheli', label: 'A new heli', icon: '🆕', pattern: /^$/},
  {key: 'others', label: 'Someone else on the sticks', icon: '🤝', pattern: /tried to fly|tried it/i},
] as const;

export type Cause = (typeof CAUSES)[number]['key'];

/** The causes a crash's notes give; "a new heli" comes from the log itself, not the notes. */
export function causesOf(notes: string): Cause[] {
  return CAUSES.filter(cause => cause.key !== 'newheli' && cause.pattern.test(notes)).map(cause => cause.key);
}

/** A heli's first two sorties: crashes there come with getting to know it. */
const NEW_HELI_SORTIES = 2;

/** For each cause, the crash sorties whose notes give it, and their crashes; and the crashes with no cause written. */
export function crashCauses(sorties: Sortie[]) {
  const tallies = new Map<Cause, {sorties: number; crashes: number}>(
    CAUSES.map(({key}) => [key, {sorties: 0, crashes: 0}]),
  );
  let silent = 0;
  let total = 0;
  const flown = new Map<string, number>();
  for (const sortie of sortSorties(sorties)) {
    const nth = (flown.get(sortie.heliId) ?? 0) + 1;
    flown.set(sortie.heliId, nth);
    if (!sortie.crashes) continue;
    total += sortie.crashes;
    const causes = causesOf(sortie.notes);
    if (nth <= NEW_HELI_SORTIES) causes.push('newheli');
    if (!causes.length) silent += sortie.crashes;
    for (const cause of causes) {
      const tally = tallies.get(cause)!;
      tally.sorties += 1;
      tally.crashes += sortie.crashes;
    }
  }
  return {causes: tallies, silent, total};
}

export interface Rung {
  skill: string;
  first: string | null;
  sorties: number;
}

/** The manoeuvre ladder, in learning order, with the day each rung was first reached. */
export function skillLadder(sorties: Sortie[]): Rung[] {
  const rungs = new Map<string, Rung>(SKILLS.map(skill => [skill, {skill, first: null, sorties: 0}]));
  for (const sortie of sortSorties(sorties)) {
    for (const skill of sortie.skills) {
      const rung = rungs.get(skill) ?? {skill, first: null, sorties: 0};
      rung.first ??= sortie.date;
      rung.sorties += 1;
      rungs.set(skill, rung);
    }
  }
  return [...rungs.values()];
}

export interface HeliLife {
  heli: Heli;
  first: string;
  last: string;
  airtime: number;
  sorties: {date: string; packs: number; crashes: number; id: string}[];
}

/** Each heli's life in the hangar, from its first sortie to its last, oldest first. */
export function fleetLives(helis: Heli[], sorties: Sortie[]): HeliLife[] {
  const lives: HeliLife[] = [];
  for (const heli of helis) {
    const own = sortSorties(sorties.filter(sortie => sortie.heliId === heli.id));
    if (!own.length) continue;
    lives.push({
      heli,
      first: heli.acquired && heli.acquired < own[0].date ? heli.acquired : own[0].date,
      last: own[own.length - 1].date,
      airtime: own.reduce((sum, sortie) => sum + airtime(sortie), 0),
      sorties: own.map(sortie => ({
        id: sortie.id,
        date: sortie.date,
        packs: sortie.packs,
        crashes: sortie.crashes ?? 0,
      })),
    });
  }
  return lives.sort((left, right) => left.first.localeCompare(right.first));
}

/** Airtime by month of the year, January first, all years together: when the flying happens. */
export function season(sorties: Sortie[]) {
  const months = Array.from({length: 12}, (_, index) => ({month: index, airtime: 0, sorties: 0}));
  for (const sortie of sorties) {
    const month = months[Number(sortie.date.slice(5, 7)) - 1];
    month.airtime += airtime(sortie);
    month.sorties += 1;
  }
  return months;
}

/** How many sorties flew one pack, two, … six or more. */
export function packsPerSortie(sorties: Sortie[]) {
  const counts = [1, 2, 3, 4, 5, 6].map(packs => ({packs, sorties: 0}));
  for (const sortie of sorties) counts[Math.min(6, Math.max(1, sortie.packs)) - 1].sorties += 1;
  return counts;
}

export interface Milestone {
  label: string;
  date: string | null;
  /** For the next one: how far along, from 0 to 1. */
  progress?: number;
  toGo?: string;
}

/** The log's milestones: hours, packs and sorties reached, and the next of each. */
export function milestones(sorties: Sortie[]): {reached: Milestone[]; next: Milestone[]} {
  const sorted = sortSorties(sorties);
  const reached: Milestone[] = [];
  const next: Milestone[] = [];
  if (sorted.length) reached.push({label: 'First flight', date: sorted[0].date});
  const ladders: {
    unit: string;
    steps: number[];
    value: (sortie: Sortie) => number;
    format: (value: number) => string;
  }[] = [
    {
      unit: 'h',
      steps: [1, 5, 10, 20, 30, 50, 75, 100, 150, 200],
      value: sortie => airtime(sortie) / 3600,
      format: value => `${value} h in the air`,
    },
    {
      unit: 'packs',
      steps: [50, 100, 250, 500, 750, 1000, 1500, 2000],
      value: sortie => sortie.packs,
      format: value => `${value} packs`,
    },
    {unit: 'sorties', steps: [10, 50, 100, 150, 200, 300, 500], value: () => 1, format: value => `${value} sorties`},
  ];
  for (const ladder of ladders) {
    let total = 0;
    let step = 0;
    for (const sortie of sorted) {
      total += ladder.value(sortie);
      while (step < ladder.steps.length && total >= ladder.steps[step]) {
        reached.push({label: ladder.format(ladder.steps[step]), date: sortie.date});
        step += 1;
      }
    }
    if (step < ladder.steps.length) {
      const target = ladder.steps[step];
      const left = target - total;
      next.push({
        label: ladder.format(target),
        date: null,
        progress: total / target,
        toGo:
          ladder.unit === 'h'
            ? `${Math.floor(left)} h ${String(Math.round((left % 1) * 60)).padStart(2, '0')} to go`
            : `${Math.ceil(left)} ${ladder.unit} to go`,
      });
    }
  }
  reached.sort((left, right) => (right.date ?? '').localeCompare(left.date ?? ''));
  return {reached, next};
}
