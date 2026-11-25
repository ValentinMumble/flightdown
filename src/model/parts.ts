import type {BrokenPart, Sortie, Spare} from '../types';
import {addDays} from './format';

/** Spare parts: the Hangar's Spares tab and the Cockpit's spares to buy, hidden when this is false. */
export const SHOW_SPARES = true;

/** Two spellings of one part match: "Main Shaft " is "main shaft", "Main blades" is "main blade". */
export function partKey(name: string) {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?<=[a-z]{3})s$/, '');
}

/** The whole heli, lost or written off: not a part to stock. */
export const WHOLE_HELI = 'Whole heli';

/**
 * Reads the broken parts cell of a sheet: one part a line, "- " before it, "x2" for two, a note in brackets.
 * "- Main blade x2" is two main blades; "- Tail boom (fixed on site)" one tail boom, fixed on site.
 */
export function parseBrokenParts(text: string): BrokenPart[] {
  return text
    .split(/\r?\n|;/)
    .map(line => line.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean)
    .map(line => {
      let part = line;
      let qty = 1;
      let note: string | undefined;
      const bracket = /\s*\(([^)]*)\)\s*$/.exec(part);
      if (bracket) {
        note = bracket[1].trim();
        part = part.slice(0, bracket.index);
      }
      const after = /\s+x\s?(\d+)$/i.exec(part);
      const before = /^(\d+)\s?x\s+/i.exec(part);
      if (after) {
        qty = Number(after[1]);
        part = part.slice(0, after.index);
      } else if (before) {
        qty = Number(before[1]);
        part = part.slice(before[0].length);
      }
      part = part.trim();
      if (part === '🚁') part = WHOLE_HELI;
      return note ? {part, qty, note} : {part, qty};
    });
}

/** How many are left: the count, less the parts broken in sorties logged since it was taken. */
export function spareStock(spare: Spare, sorties: Sortie[]) {
  const key = partKey(spare.name);
  let used = 0;
  for (const sortie of sorties) {
    if (sortie.loggedAt <= spare.countedAt) continue;
    if (spare.heliId && sortie.heliId !== spare.heliId) continue;
    for (const broken of sortie.broken) if (partKey(broken.part) === key) used += broken.qty;
  }
  return spare.count - used;
}

/** The shopping list keeps this many weeks of each part at the rate you break it. */
export const RUNWAY_WEEKS = 4;
/** How you fly now: the packs of the last 8 weeks. */
const RECENT_DAYS = 56;

/** How long a spare lasts at the rate you break it and fly now, and how many to buy. */
export interface Runway {
  /** Parts broken a pack flown, over the heli's whole log (or every heli's, for a part that fits several). */
  perPack: number;
  /** Packs flown a week, over the last 8 weeks. */
  packsPerWeek: number;
  /** Weeks until the stock runs out; null when it does not at this rate (never broken, or not flying). */
  weeks: number | null;
  /** How many to buy to keep its minimum and 4 weeks' worth. */
  buy: number;
}

export function spareRunway(spare: Spare, sorties: Sortie[], stock: number, day: string): Runway {
  const key = partKey(spare.name);
  const own = spare.heliId ? sorties.filter(sortie => sortie.heliId === spare.heliId) : sorties;
  const packs = own.reduce((sum, sortie) => sum + sortie.packs, 0);
  let broken = 0;
  for (const sortie of own) for (const part of sortie.broken) if (partKey(part.part) === key) broken += part.qty;
  const since = addDays(day, -RECENT_DAYS);
  const recent = own.filter(sortie => sortie.date > since && sortie.date <= day);
  const packsPerWeek = (recent.reduce((sum, sortie) => sum + sortie.packs, 0) * 7) / RECENT_DAYS;
  const perPack = packs ? broken / packs : 0;
  const perWeek = perPack * packsPerWeek;
  const left = Math.max(0, stock);
  return {
    perPack,
    packsPerWeek,
    weeks: perWeek > 0 ? left / perWeek : null,
    buy: Math.max(0, spare.min - stock, Math.ceil(perWeek * RUNWAY_WEEKS) - stock),
  };
}

/** How long a runway is, in words: "runs out this week", "about 3 weeks", "about 4 months". */
export function runwayText(weeks: number | null): string {
  if (weeks === null) return 'lasts at this rate';
  if (weeks < 1) return 'runs out this week';
  if (weeks < 8) return `about ${Math.round(weeks)} week${Math.round(weeks) === 1 ? '' : 's'}`;
  if (weeks < 52) return `about ${Math.round(weeks / 4.35)} months`;
  return 'a year or more';
}

export interface PartTally {
  key: string;
  /** The spelling used most recently. */
  name: string;
  qty: number;
  sorties: number;
  last: string;
  heliIds: string[];
}

/** The parts broken most often, whole helis aside. */
export function brokenRanking(sorties: Sortie[]): PartTally[] {
  const tallies = new Map<string, PartTally>();
  const sorted = [...sorties].sort((left, right) => left.date.localeCompare(right.date));
  for (const sortie of sorted) {
    for (const broken of sortie.broken) {
      if (broken.part === WHOLE_HELI) continue;
      const key = partKey(broken.part);
      const tally = tallies.get(key) ?? {key, name: broken.part, qty: 0, sorties: 0, last: sortie.date, heliIds: []};
      tally.name = broken.part;
      tally.qty += broken.qty;
      tally.sorties += 1;
      tally.last = sortie.date;
      if (!tally.heliIds.includes(sortie.heliId)) tally.heliIds.push(sortie.heliId);
      tallies.set(key, tally);
    }
  }
  return [...tallies.values()].sort((left, right) => right.qty - left.qty || right.last.localeCompare(left.last));
}

/** Part names to offer when logging a sortie on a heli: its spares first, then what broke on it before. */
export function partSuggestions(heliId: string | undefined, sorties: Sortie[], spares: Spare[]) {
  const names = new Map<string, string>();
  for (const spare of spares) {
    if (!spare.heliId || spare.heliId === heliId) names.set(partKey(spare.name), spare.name);
  }
  const mine = sorties.filter(sortie => sortie.heliId === heliId);
  for (const tally of [...brokenRanking(mine), ...brokenRanking(sorties)]) {
    if (!names.has(tally.key)) names.set(tally.key, tally.name);
  }
  return [...names.values()];
}
