import type {BrokenPart, Sortie, Spare} from '../types';

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
