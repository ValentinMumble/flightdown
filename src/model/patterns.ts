/**
 * Patterns in the crashes: whether they come in runs, how indoors compares with outdoors, and how the time since the
 * last sortie goes with them. Only sorties whose crash count is known count.
 */
import type {Sortie} from '../types';
import {daysBetween} from './format';
import {sortSorties} from './stats';

export interface Tally {
  sorties: number;
  /** Sorties with a crash. */
  crashed: number;
  packs: number;
  crashes: number;
}

const empty = (): Tally => ({sorties: 0, crashed: 0, packs: 0, crashes: 0});

function add(tally: Tally, sortie: Sortie) {
  tally.sorties += 1;
  tally.crashed += Number((sortie.crashes ?? 0) > 0);
  tally.packs += sortie.packs;
  tally.crashes += sortie.crashes ?? 0;
}

/** Packs flown for each crash (all of them when there was none). */
export const packsPerCrash = (tally: Pick<Tally, 'packs' | 'crashes'>) => tally.packs / Math.max(1, tally.crashes);
/** The share of sorties with a crash, 0 to 1. */
export const crashedShare = (tally: Tally) => (tally.sorties ? tally.crashed / tally.sorties : 0);

/** Days since the sortie before, in bands. */
export const GAPS = [
  {upTo: 3, label: 'Within 3 days'},
  {upTo: 10, label: '4 to 10 days'},
  {upTo: 30, label: '11 to 30 days'},
  {upTo: Infinity, label: 'Over a month'},
];

export interface CrashPatterns {
  all: Tally;
  /** The sorties right after one with a crash, and right after one without. */
  afterCrash: Tally;
  afterClean: Tally;
  indoor: Tally;
  outdoor: Tally;
  /** By the days since the sortie before (any heli), as GAPS. */
  gaps: Tally[];
}

/** The patterns of the sorties given, the order they flew in. */
export function crashPatterns(sorties: Sortie[]): CrashPatterns {
  const patterns: CrashPatterns = {
    all: empty(),
    afterCrash: empty(),
    afterClean: empty(),
    indoor: empty(),
    outdoor: empty(),
    gaps: GAPS.map(empty),
  };
  const sorted = sortSorties(sorties);
  sorted.forEach((sortie, index) => {
    if (sortie.crashes === null) return;
    add(patterns.all, sortie);
    add(sortie.indoor ? patterns.indoor : patterns.outdoor, sortie);
    const before = sorted[index - 1];
    if (!before) return;
    if (before.crashes !== null) add((before.crashes ?? 0) > 0 ? patterns.afterCrash : patterns.afterClean, sortie);
    const gap = daysBetween(before.date, sortie.date);
    add(patterns.gaps[GAPS.findIndex(band => gap <= band.upTo)], sortie);
  });
  return patterns;
}
