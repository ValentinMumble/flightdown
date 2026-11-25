/**
 * Personal bests, on one heli or all of them, from the sorties and their logs: the longest time inverted in one go, the
 * most flips and rolls in one pack, and the longest run of packs without a crash.
 */
import type {Sortie, TelemetrySeries} from '../types';
import {flipCounts, invertedStretches} from './insights';
import {sortiePacks} from './packs';
import {sortSorties} from './stats';

export interface PersonalBests {
  /** Seconds upside down in one go, and the day. */
  inverted: {seconds: number; date: string; heliId: string} | null;
  /** Flips and rolls made whole in one pack, and the day. */
  flips: {count: number; date: string; heliId: string} | null;
  /** Packs flown in a row with no crash (sorties with a known crash count), from one day to another. */
  cleanRun: {packs: number; from: string; to: string} | null;
}

export function personalBests(sorties: Sortie[], series: ReadonlyMap<string, TelemetrySeries>): PersonalBests {
  let inverted: PersonalBests['inverted'] = null;
  let flips: PersonalBests['flips'] = null;
  let cleanRun: PersonalBests['cleanRun'] = null;
  let run: PersonalBests['cleanRun'] = null;
  for (const sortie of sortSorties(sorties)) {
    for (const pack of sortiePacks(sortie)) {
      let count = 0;
      for (const file of pack.files) {
        const read = series.get(file.id);
        if (!read) continue;
        for (const stretch of invertedStretches(read)) {
          if (!inverted || stretch.seconds > inverted.seconds) {
            inverted = {seconds: stretch.seconds, date: sortie.date, heliId: sortie.heliId};
          }
        }
        count += Object.values(flipCounts(read)).reduce((sum, each) => sum + (each ?? 0), 0);
      }
      if (count && (!flips || count > flips.count)) flips = {count, date: sortie.date, heliId: sortie.heliId};
    }
    if (sortie.crashes === null) continue;
    if (sortie.crashes > 0) {
      run = null;
      continue;
    }
    const going: {packs: number; from: string; to: string} = run
      ? {packs: run.packs + sortie.packs, from: run.from, to: sortie.date}
      : {packs: sortie.packs, from: sortie.date, to: sortie.date};
    run = going;
    if (!cleanRun || going.packs > cleanRun.packs) cleanRun = {...going};
  }
  return {inverted, flips, cleanRun};
}
