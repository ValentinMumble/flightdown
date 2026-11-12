import type {Sortie} from '../types';
import {daysBetween, fromDay, pad, today} from './format';
import {SKILLS} from './skills';
import {groupPacks} from './packs';

/** Seconds in the air: packs times the flight time of one pack (nothing when the timer is not known). */
/**
 * Each pack's time in the air from its logs (the motor on), when every pack of the sortie has a log saying it; else
 * null, and its packs count its timer.
 */
export function loggedTimes(sortie: Sortie): number[] | null {
  if (!sortie.telemetry.length || sortie.telemetry.some(log => log.flying === undefined)) return null;
  const packs = groupPacks(sortie.telemetry);
  if (packs.length < sortie.packs) return null;
  return packs.map(pack => pack.files.reduce((sum, file) => sum + (file.flying ?? 0), 0));
}

/** A sortie's time in the air: its logs' when they cover every pack, else its packs times its timer. */
export const airtime = (sortie: Sortie) => {
  const logged = loggedTimes(sortie);
  if (logged) return logged.reduce((sum, seconds) => sum + seconds, 0);
  return sortie.timer ? sortie.packs * sortie.timer : 0;
};

export const byDate = (left: Sortie, right: Sortie) =>
  left.date.localeCompare(right.date) || left.loggedAt.localeCompare(right.loggedAt);

export const sortSorties = (sorties: Sortie[]) => [...sorties].sort(byDate);

export interface Totals {
  sorties: number;
  packs: number;
  airtime: number;
  crashes: number;
  /** Sorties whose crash count is known, and their packs and airtime: the rates only count those. */
  knownSorties: number;
  knownPacks: number;
  knownAirtime: number;
  flyingDays: number;
  crashesPerHour: number | null;
  packsPerCrash: number | null;
  crashesPerSortie: number | null;
}

export function totals(sorties: Sortie[]): Totals {
  let packs = 0;
  let time = 0;
  let crashes = 0;
  let knownSorties = 0;
  let knownPacks = 0;
  let knownAirtime = 0;
  const days = new Set<string>();
  for (const sortie of sorties) {
    packs += sortie.packs;
    time += airtime(sortie);
    days.add(sortie.date);
    if (sortie.crashes !== null) {
      crashes += sortie.crashes;
      knownSorties += 1;
      knownPacks += sortie.packs;
      knownAirtime += airtime(sortie);
    }
  }
  return {
    sorties: sorties.length,
    packs,
    airtime: time,
    crashes,
    knownSorties,
    knownPacks,
    knownAirtime,
    flyingDays: days.size,
    crashesPerHour: knownAirtime > 0 ? crashes / (knownAirtime / 3600) : null,
    packsPerCrash: crashes > 0 ? knownPacks / crashes : null,
    crashesPerSortie: knownSorties > 0 ? crashes / knownSorties : null,
  };
}

export const monthOf = (day: string) => day.slice(0, 7);

/** Every month from one to another, both included. */
export function monthRange(from: string, to: string) {
  const months: string[] = [];
  let [year, month] = from.split('-').map(Number);
  const [lastYear, lastMonth] = to.split('-').map(Number);
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    months.push(`${year}-${pad(month)}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

export interface MonthTally {
  month: string;
  sorties: number;
  packs: number;
  airtime: number;
  crashes: number;
  /** Airtime by heli id. */
  byHeli: Record<string, number>;
}

/** One tally per month, empty months included, from the first sortie's month to the last's (or `until`). */
export function monthly(sorties: Sortie[], until?: string): MonthTally[] {
  if (!sorties.length) return [];
  const sorted = sortSorties(sorties);
  const months = monthRange(monthOf(sorted[0].date), until ?? monthOf(sorted[sorted.length - 1].date));
  const tallies = new Map(
    months.map(month => [month, {month, sorties: 0, packs: 0, airtime: 0, crashes: 0, byHeli: {}} as MonthTally]),
  );
  for (const sortie of sorted) {
    const tally = tallies.get(monthOf(sortie.date));
    if (!tally) continue;
    tally.sorties += 1;
    tally.packs += sortie.packs;
    tally.airtime += airtime(sortie);
    tally.crashes += sortie.crashes ?? 0;
    tally.byHeli[sortie.heliId] = (tally.byHeli[sortie.heliId] ?? 0) + airtime(sortie);
  }
  return [...tallies.values()];
}

export interface TrendPoint {
  date: string;
  /** Crashes per hour over the window ending with this sortie. */
  rate: number;
  /** Packs flown per crash over the same window. */
  packsPerCrash: number | null;
  /** Crashes every ten packs over the same window: the unit a pilot counts in. */
  per10: number;
}

/**
 * The crash rate over the last few sorties, at each sortie: a sliding window smooths the months with one short
 * sortie (one crash in two minutes is not 30 crashes an hour). Sorties with an unknown crash count are skipped.
 */
export function crashTrend(sorties: Sortie[], window = 10): TrendPoint[] {
  const known = sortSorties(sorties).filter(sortie => sortie.crashes !== null && airtime(sortie) > 0);
  const points: TrendPoint[] = [];
  for (let index = window - 1; index < known.length; index += 1) {
    const slice = known.slice(index - window + 1, index + 1);
    const crashes = slice.reduce((sum, sortie) => sum + (sortie.crashes ?? 0), 0);
    const time = slice.reduce((sum, sortie) => sum + airtime(sortie), 0);
    const packs = slice.reduce((sum, sortie) => sum + sortie.packs, 0);
    points.push({
      date: known[index].date,
      rate: crashes / (time / 3600),
      packsPerCrash: crashes ? packs / crashes : null,
      per10: (crashes / packs) * 10,
    });
  }
  return points;
}

export interface GroupTally {
  key: string;
  sorties: number;
  packs: number;
  airtime: number;
  crashes: number;
  first: string;
  last: string;
}

/** Sorties grouped (by heli, by spot), most airtime first. */
export function groupBy(sorties: Sortie[], keyOf: (sortie: Sortie) => string | undefined): GroupTally[] {
  const groups = new Map<string, GroupTally>();
  for (const sortie of sortSorties(sorties)) {
    const key = keyOf(sortie) ?? '';
    const group = groups.get(key) ?? {
      key,
      sorties: 0,
      packs: 0,
      airtime: 0,
      crashes: 0,
      first: sortie.date,
      last: sortie.date,
    };
    group.sorties += 1;
    group.packs += sortie.packs;
    group.airtime += airtime(sortie);
    group.crashes += sortie.crashes ?? 0;
    group.last = sortie.date;
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => right.airtime - left.airtime || right.sorties - left.sorties);
}

/** Sorties and airtime by day of the week, Monday first. */
export function weekdays(sorties: Sortie[]) {
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const tallies = names.map(name => ({name, sorties: 0, airtime: 0}));
  for (const sortie of sorties) {
    const tally = tallies[(fromDay(sortie.date).getDay() + 6) % 7];
    tally.sorties += 1;
    tally.airtime += airtime(sortie);
  }
  return tallies;
}

/** Airtime by day. */
export function daily(sorties: Sortie[]) {
  const days = new Map<string, number>();
  for (const sortie of sorties) days.set(sortie.date, (days.get(sortie.date) ?? 0) + airtime(sortie));
  return days;
}

/** Airtime added up through each year, by day of the year: one line per year. */
export function cumulativeByYear(sorties: Sortie[]) {
  const years = new Map<number, {day: number; hours: number}[]>();
  for (const sortie of sortSorties(sorties)) {
    const date = fromDay(sortie.date);
    const year = date.getFullYear();
    const points = years.get(year) ?? [{day: 0, hours: 0}];
    const day = daysBetween(`${year}-01-01`, sortie.date) + 1;
    const total = points[points.length - 1].hours + airtime(sortie) / 3600;
    if (points[points.length - 1].day === day) points[points.length - 1].hours = total;
    else points.push({day, hours: total});
    years.set(year, points);
  }
  return years;
}

export interface Streaks {
  /** Sorties and packs since the last crash (sorties with an unknown count end the run). */
  crashFreeSorties: number;
  crashFreePacks: number;
  longestCrashFree: {sorties: number; packs: number; from: string; to: string} | null;
  daysSinceLast: number | null;
  longestBreak: {days: number; from: string; to: string} | null;
}

export function streaks(sorties: Sortie[], now = today()): Streaks {
  const sorted = sortSorties(sorties);
  let crashFreeSorties = 0;
  let crashFreePacks = 0;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (sorted[index].crashes !== 0) break;
    crashFreeSorties += 1;
    crashFreePacks += sorted[index].packs;
  }
  type Run = {sorties: number; packs: number; from: string; to: string};
  let longestCrashFree: Run | null = null as Run | null;
  let run: Run | null = null as Run | null;
  for (const sortie of sorted) {
    if (sortie.crashes === 0) {
      const next: Run = run
        ? {from: run.from, sorties: run.sorties + 1, packs: run.packs + sortie.packs, to: sortie.date}
        : {sorties: 1, packs: sortie.packs, from: sortie.date, to: sortie.date};
      run = next;
      if (!longestCrashFree || next.packs > longestCrashFree.packs) longestCrashFree = next;
    } else {
      run = null;
    }
  }
  let longestBreak: Streaks['longestBreak'] = null;
  for (let index = 1; index < sorted.length; index += 1) {
    const days = daysBetween(sorted[index - 1].date, sorted[index].date);
    if (!longestBreak || days > longestBreak.days) {
      longestBreak = {days, from: sorted[index - 1].date, to: sorted[index].date};
    }
  }
  return {
    crashFreeSorties,
    crashFreePacks,
    longestCrashFree,
    daysSinceLast: sorted.length ? daysBetween(sorted[sorted.length - 1].date, now) : null,
    longestBreak,
  };
}

export interface Records {
  longestSortie: Sortie | null;
  mostPacksDay: {date: string; packs: number} | null;
  bestMonth: {month: string; airtime: number} | null;
  bestYear: {year: string; airtime: number} | null;
}

export function records(sorties: Sortie[]): Records {
  let longestSortie: Sortie | null = null;
  for (const sortie of sorties) {
    if (!longestSortie || airtime(sortie) > airtime(longestSortie)) longestSortie = sortie;
  }
  const packsByDay = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const byYear = new Map<string, number>();
  for (const sortie of sorties) {
    packsByDay.set(sortie.date, (packsByDay.get(sortie.date) ?? 0) + sortie.packs);
    byMonth.set(monthOf(sortie.date), (byMonth.get(monthOf(sortie.date)) ?? 0) + airtime(sortie));
    byYear.set(sortie.date.slice(0, 4), (byYear.get(sortie.date.slice(0, 4)) ?? 0) + airtime(sortie));
  }
  const top = <T>(map: Map<string, number>, make: (key: string, value: number) => T) => {
    let best: [string, number] | null = null;
    for (const entry of map) if (!best || entry[1] > best[1]) best = entry;
    return best ? make(best[0], best[1]) : null;
  };
  return {
    longestSortie,
    mostPacksDay: top(packsByDay, (date, packs) => ({date, packs})),
    bestMonth: top(byMonth, (month, time) => ({month, airtime: time})),
    bestYear: top(byYear, (year, time) => ({year, airtime: time})),
  };
}

export interface SkillProgress {
  skill: string;
  first: string;
  last: string;
  sorties: number;
}

/** When each manoeuvre was first and last practised, in the order they are learnt. */
export function skillProgress(sorties: Sortie[]): SkillProgress[] {
  const progress = new Map<string, SkillProgress>();
  for (const sortie of sortSorties(sorties)) {
    for (const skill of sortie.skills) {
      const entry = progress.get(skill) ?? {skill, first: sortie.date, last: sortie.date, sorties: 0};
      entry.last = sortie.date;
      entry.sorties += 1;
      progress.set(skill, entry);
    }
  }
  const order = (skill: string) => {
    const index = SKILLS.indexOf(skill);
    return index < 0 ? SKILLS.length : index;
  };
  return [...progress.values()].sort(
    (left, right) => left.first.localeCompare(right.first) || order(left.skill) - order(right.skill),
  );
}

/** Packs flown since a heli's last crash, or since its first flight. */
export function packsSinceCrash(sorties: Sortie[]) {
  const sorted = sortSorties(sorties);
  let packs = 0;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (sorted[index].crashes) break;
    packs += sorted[index].packs;
  }
  return packs;
}

/** Days since the last sortie that ended in a crash, as a workshop's "days since the last accident"; null if none. */
export function daysSinceCrash(sorties: Sortie[], now = today()) {
  const crashed = sortSorties(sorties).filter(sortie => sortie.crashes);
  const last = crashed[crashed.length - 1];
  return last ? daysBetween(last.date, now) : null;
}
