/**
 * Personal bests, on one heli or all of them, from the sorties and their logs: in one pack (the longest in the air,
 * the longest inverted in one go and in all, the most flips and rolls, the longest chain of them, the most current
 * pulled), in one day (the most airtime, the most packs), and in a row (packs without a crash, flying days).
 */
import type {Sortie, TelemetrySeries} from '../types';
import {flipCounts, invertedStretches, turnOvers} from './insights';
import {flyingStats} from './flying';
import {sortiePacks} from './packs';
import {addDays} from './format';
import {airtime, sortSorties} from './stats';

/** Flips and rolls this close (s) are one chain: the next one goes over before the heli settles. */
export const CHAIN_GAP = 1.5;

export type BestKind =
  | 'packTime'
  | 'inverted'
  | 'packInverted'
  | 'flips'
  | 'flipChain'
  | 'amps'
  | 'dayAirtime'
  | 'dayPacks'
  | 'cleanRun'
  | 'flyingDays';

export interface Best {
  kind: BestKind;
  /** The number it is measured by: seconds, flips, amps, packs or days. */
  value: number;
  /** The day it was set, or the first and last day of a run. */
  date: string;
  to?: string;
  /** The heli that set it, for a best in one pack. */
  heliId?: string;
}

/** The bests in the order they are shown, each the first time it was reached (a tie keeps the older). */
export const BEST_ORDER: BestKind[] = [
  'packTime',
  'inverted',
  'packInverted',
  'flips',
  'flipChain',
  'amps',
  'dayAirtime',
  'dayPacks',
  'cleanRun',
  'flyingDays',
];

/** The longest chain of whole flips and rolls in a log, each starting within CHAIN_GAP of the one before ending. */
export function flipChain(series: TelemetrySeries): number {
  let longest = 0;
  let chain = 0;
  let end = -Infinity;
  for (const turn of turnOvers(series)) {
    if (turn.going !== turn.coming) continue;
    chain = turn.start - end <= CHAIN_GAP ? chain + 1 : 1;
    end = turn.end;
    longest = Math.max(longest, chain);
  }
  return longest;
}

/** The most current a log held (A): over two samples in a row, so a single spike does not count. */
export function peakAmps(series: TelemetrySeries): number {
  const current = series.channels.current ?? [];
  let peak = 0;
  for (let index = 1; index < current.length; index += 1)
    peak = Math.max(peak, Math.min(current[index - 1], current[index]));
  return peak;
}

export function personalBests(sorties: Sortie[], series: ReadonlyMap<string, TelemetrySeries>): Best[] {
  const bests = new Map<BestKind, Best>();
  const offer = (best: Best) => {
    if (best.value > 0 && best.value > (bests.get(best.kind)?.value ?? 0)) bests.set(best.kind, best);
  };
  const sorted = sortSorties(sorties);
  const days = new Map<string, {airtime: number; packs: number}>();
  let run: {packs: number; from: string; to: string} | null = null;
  for (const sortie of sorted) {
    const day = days.get(sortie.date) ?? {airtime: 0, packs: 0};
    days.set(sortie.date, {airtime: day.airtime + airtime(sortie), packs: day.packs + sortie.packs});
    const set = {date: sortie.date, heliId: sortie.heliId};
    for (const pack of sortiePacks(sortie)) {
      const reads = pack.files.flatMap(file => series.get(file.id) ?? []);
      if (!reads.length) continue;
      let flying = 0;
      let upsideDown = 0;
      let flips = 0;
      for (const read of reads) {
        flying += flyingStats(read, sortie.date)?.flying ?? 0;
        for (const stretch of invertedStretches(read)) {
          upsideDown += stretch.seconds;
          offer({kind: 'inverted', value: stretch.seconds, ...set});
        }
        flips += Object.values(flipCounts(read)).reduce((sum, each) => sum + (each ?? 0), 0);
        offer({kind: 'flipChain', value: flipChain(read), ...set});
        offer({kind: 'amps', value: peakAmps(read), ...set});
      }
      offer({kind: 'packTime', value: flying, ...set});
      offer({kind: 'packInverted', value: upsideDown, ...set});
      offer({kind: 'flips', value: flips, ...set});
    }
    // Packs without a crash: a sortie with an unknown count neither ends nor adds to the run.
    if (sortie.crashes === null) continue;
    if (sortie.crashes > 0) {
      run = null;
      continue;
    }
    const going: {packs: number; from: string; to: string} = run
      ? {packs: run.packs + sortie.packs, from: run.from, to: sortie.date}
      : {packs: sortie.packs, from: sortie.date, to: sortie.date};
    run = going;
    offer({kind: 'cleanRun', value: going.packs, date: going.from, to: going.to});
  }
  let streak: {days: number; from: string; to: string} | null = null;
  for (const [date, day] of days) {
    offer({kind: 'dayAirtime', value: day.airtime, date});
    offer({kind: 'dayPacks', value: day.packs, date});
    const next: {days: number; from: string; to: string} =
      streak && addDays(streak.to, 1) === date
        ? {days: streak.days + 1, from: streak.from, to: date}
        : {days: 1, from: date, to: date};
    streak = next;
    if (next.days > 1) offer({kind: 'flyingDays', value: next.days, date: next.from, to: next.to});
  }
  return BEST_ORDER.flatMap(kind => bests.get(kind) ?? []);
}
