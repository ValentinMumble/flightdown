import type {Session} from '../types';
import {daysBetween, fromDay, pad, today} from './format';
import {SKILLS} from './skills';

/** Seconds in the air: packs times the flight time of one pack (nothing when the timer is not known). */
export const airtime = (session: Session) => (session.timer ? session.packs * session.timer : 0);

export const byDate = (left: Session, right: Session) =>
  left.date.localeCompare(right.date) || left.loggedAt.localeCompare(right.loggedAt);

export const sortSessions = (sessions: Session[]) => [...sessions].sort(byDate);

export interface Totals {
  sessions: number;
  packs: number;
  airtime: number;
  crashes: number;
  /** Sessions whose crash count is known, and their packs and airtime: the rates only count those. */
  knownSessions: number;
  knownPacks: number;
  knownAirtime: number;
  flyingDays: number;
  crashesPerHour: number | null;
  packsPerCrash: number | null;
  crashesPerSession: number | null;
}

export function totals(sessions: Session[]): Totals {
  let packs = 0;
  let time = 0;
  let crashes = 0;
  let knownSessions = 0;
  let knownPacks = 0;
  let knownAirtime = 0;
  const days = new Set<string>();
  for (const session of sessions) {
    packs += session.packs;
    time += airtime(session);
    days.add(session.date);
    if (session.crashes !== null) {
      crashes += session.crashes;
      knownSessions += 1;
      knownPacks += session.packs;
      knownAirtime += airtime(session);
    }
  }
  return {
    sessions: sessions.length,
    packs,
    airtime: time,
    crashes,
    knownSessions,
    knownPacks,
    knownAirtime,
    flyingDays: days.size,
    crashesPerHour: knownAirtime > 0 ? crashes / (knownAirtime / 3600) : null,
    packsPerCrash: crashes > 0 ? knownPacks / crashes : null,
    crashesPerSession: knownSessions > 0 ? crashes / knownSessions : null,
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
  sessions: number;
  packs: number;
  airtime: number;
  crashes: number;
  /** Airtime by heli id. */
  byHeli: Record<string, number>;
}

/** One tally per month, empty months included, from the first session's month to the last's (or `until`). */
export function monthly(sessions: Session[], until?: string): MonthTally[] {
  if (!sessions.length) return [];
  const sorted = sortSessions(sessions);
  const months = monthRange(monthOf(sorted[0].date), until ?? monthOf(sorted[sorted.length - 1].date));
  const tallies = new Map(
    months.map(month => [month, {month, sessions: 0, packs: 0, airtime: 0, crashes: 0, byHeli: {}} as MonthTally]),
  );
  for (const session of sorted) {
    const tally = tallies.get(monthOf(session.date));
    if (!tally) continue;
    tally.sessions += 1;
    tally.packs += session.packs;
    tally.airtime += airtime(session);
    tally.crashes += session.crashes ?? 0;
    tally.byHeli[session.heliId] = (tally.byHeli[session.heliId] ?? 0) + airtime(session);
  }
  return [...tallies.values()];
}

export interface TrendPoint {
  date: string;
  /** Crashes per hour over the window ending with this session. */
  rate: number;
  /** Packs flown per crash over the same window. */
  packsPerCrash: number | null;
  /** Crashes every ten packs over the same window: the unit a pilot counts in. */
  per10: number;
}

/**
 * The crash rate over the last few sessions, at each session: a sliding window smooths the months with one short
 * session (one crash in two minutes is not 30 crashes an hour). Sessions with an unknown crash count are skipped.
 */
export function crashTrend(sessions: Session[], window = 10): TrendPoint[] {
  const known = sortSessions(sessions).filter(session => session.crashes !== null && airtime(session) > 0);
  const points: TrendPoint[] = [];
  for (let index = window - 1; index < known.length; index += 1) {
    const slice = known.slice(index - window + 1, index + 1);
    const crashes = slice.reduce((sum, session) => sum + (session.crashes ?? 0), 0);
    const time = slice.reduce((sum, session) => sum + airtime(session), 0);
    const packs = slice.reduce((sum, session) => sum + session.packs, 0);
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
  sessions: number;
  packs: number;
  airtime: number;
  crashes: number;
  first: string;
  last: string;
}

/** Sessions grouped (by heli, by spot), most airtime first. */
export function groupBy(sessions: Session[], keyOf: (session: Session) => string | undefined): GroupTally[] {
  const groups = new Map<string, GroupTally>();
  for (const session of sortSessions(sessions)) {
    const key = keyOf(session) ?? '';
    const group = groups.get(key) ?? {
      key,
      sessions: 0,
      packs: 0,
      airtime: 0,
      crashes: 0,
      first: session.date,
      last: session.date,
    };
    group.sessions += 1;
    group.packs += session.packs;
    group.airtime += airtime(session);
    group.crashes += session.crashes ?? 0;
    group.last = session.date;
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => right.airtime - left.airtime || right.sessions - left.sessions);
}

/** Sessions and airtime by day of the week, Monday first. */
export function weekdays(sessions: Session[]) {
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const tallies = names.map(name => ({name, sessions: 0, airtime: 0}));
  for (const session of sessions) {
    const tally = tallies[(fromDay(session.date).getDay() + 6) % 7];
    tally.sessions += 1;
    tally.airtime += airtime(session);
  }
  return tallies;
}

/** Airtime by day. */
export function daily(sessions: Session[]) {
  const days = new Map<string, number>();
  for (const session of sessions) days.set(session.date, (days.get(session.date) ?? 0) + airtime(session));
  return days;
}

/** Airtime added up through each year, by day of the year: one line per year. */
export function cumulativeByYear(sessions: Session[]) {
  const years = new Map<number, {day: number; hours: number}[]>();
  for (const session of sortSessions(sessions)) {
    const date = fromDay(session.date);
    const year = date.getFullYear();
    const points = years.get(year) ?? [{day: 0, hours: 0}];
    const day = daysBetween(`${year}-01-01`, session.date) + 1;
    const total = points[points.length - 1].hours + airtime(session) / 3600;
    if (points[points.length - 1].day === day) points[points.length - 1].hours = total;
    else points.push({day, hours: total});
    years.set(year, points);
  }
  return years;
}

export interface Streaks {
  /** Sessions and packs since the last crash (sessions with an unknown count end the run). */
  crashFreeSessions: number;
  crashFreePacks: number;
  longestCrashFree: {sessions: number; packs: number; from: string; to: string} | null;
  daysSinceLast: number | null;
  longestBreak: {days: number; from: string; to: string} | null;
}

export function streaks(sessions: Session[], now = today()): Streaks {
  const sorted = sortSessions(sessions);
  let crashFreeSessions = 0;
  let crashFreePacks = 0;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (sorted[index].crashes !== 0) break;
    crashFreeSessions += 1;
    crashFreePacks += sorted[index].packs;
  }
  type Run = {sessions: number; packs: number; from: string; to: string};
  let longestCrashFree: Run | null = null as Run | null;
  let run: Run | null = null as Run | null;
  for (const session of sorted) {
    if (session.crashes === 0) {
      const next: Run = run
        ? {from: run.from, sessions: run.sessions + 1, packs: run.packs + session.packs, to: session.date}
        : {sessions: 1, packs: session.packs, from: session.date, to: session.date};
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
    crashFreeSessions,
    crashFreePacks,
    longestCrashFree,
    daysSinceLast: sorted.length ? daysBetween(sorted[sorted.length - 1].date, now) : null,
    longestBreak,
  };
}

export interface Records {
  longestSession: Session | null;
  mostPacksDay: {date: string; packs: number} | null;
  bestMonth: {month: string; airtime: number} | null;
  bestYear: {year: string; airtime: number} | null;
}

export function records(sessions: Session[]): Records {
  let longestSession: Session | null = null;
  for (const session of sessions) {
    if (!longestSession || airtime(session) > airtime(longestSession)) longestSession = session;
  }
  const packsByDay = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const byYear = new Map<string, number>();
  for (const session of sessions) {
    packsByDay.set(session.date, (packsByDay.get(session.date) ?? 0) + session.packs);
    byMonth.set(monthOf(session.date), (byMonth.get(monthOf(session.date)) ?? 0) + airtime(session));
    byYear.set(session.date.slice(0, 4), (byYear.get(session.date.slice(0, 4)) ?? 0) + airtime(session));
  }
  const top = <T>(map: Map<string, number>, make: (key: string, value: number) => T) => {
    let best: [string, number] | null = null;
    for (const entry of map) if (!best || entry[1] > best[1]) best = entry;
    return best ? make(best[0], best[1]) : null;
  };
  return {
    longestSession,
    mostPacksDay: top(packsByDay, (date, packs) => ({date, packs})),
    bestMonth: top(byMonth, (month, time) => ({month, airtime: time})),
    bestYear: top(byYear, (year, time) => ({year, airtime: time})),
  };
}

export interface SkillProgress {
  skill: string;
  first: string;
  last: string;
  sessions: number;
}

/** When each manoeuvre was first and last practised, in the order they are learnt. */
export function skillProgress(sessions: Session[]): SkillProgress[] {
  const progress = new Map<string, SkillProgress>();
  for (const session of sortSessions(sessions)) {
    for (const skill of session.skills) {
      const entry = progress.get(skill) ?? {skill, first: session.date, last: session.date, sessions: 0};
      entry.last = session.date;
      entry.sessions += 1;
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
export function packsSinceCrash(sessions: Session[]) {
  const sorted = sortSessions(sessions);
  let packs = 0;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (sorted[index].crashes) break;
    packs += sorted[index].packs;
  }
  return packs;
}
