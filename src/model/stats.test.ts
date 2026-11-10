import {describe, expect, it} from 'vitest';
import type {Session} from '../types';
import {crashTrend, daysSinceCrash, monthly, monthRange, streaks, totals} from './stats';

let count = 0;
const session = (date: string, packs: number, crashes: number | null, timer: number | null = 300): Session => ({
  id: `s${(count += 1)}`,
  date,
  heliId: 'h',
  packs,
  timer,
  crashes,
  broken: [],
  skills: [],
  notes: '',
  links: [],
  telemetry: [],
  loggedAt: `${date}T20:00:00`,
});

describe('totals', () => {
  it('leaves sessions with an unknown crash count out of the rates', () => {
    const all = totals([session('2026-01-01', 4, 2), session('2026-01-02', 2, null), session('2026-01-02', 4, 0)]);
    expect(all.airtime).toBe(10 * 300);
    expect(all.crashes).toBe(2);
    expect(all.packsPerCrash).toBe(4);
    expect(all.crashesPerHour).toBeCloseTo(2 / ((8 * 300) / 3600));
    expect(all.flyingDays).toBe(2);
  });

  it('counts no airtime without a timer', () => {
    expect(totals([session('2026-01-01', 3, 0, null)]).airtime).toBe(0);
  });
});

describe('monthly', () => {
  it('keeps empty months between two sessions', () => {
    const months = monthly([session('2025-11-20', 2, 0), session('2026-02-01', 1, 1)]);
    expect(months.map(month => month.month)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(months[1].airtime).toBe(0);
    expect(monthRange('2025-12', '2026-01')).toEqual(['2025-12', '2026-01']);
  });
});

describe('streaks', () => {
  it('finds the current and the longest crash-free runs', () => {
    const runs = streaks(
      [
        session('2026-01-01', 3, 0),
        session('2026-01-02', 5, 0),
        session('2026-01-03', 2, 1),
        session('2026-01-10', 4, 0),
      ],
      '2026-01-12',
    );
    expect(runs.crashFreePacks).toBe(4);
    expect(runs.longestCrashFree?.packs).toBe(8);
    expect(runs.daysSinceLast).toBe(2);
    expect(runs.longestBreak?.days).toBe(7);
  });
});

describe('crashTrend', () => {
  it('slides a window over the sessions with a known count', () => {
    const sessions = Array.from({length: 12}, (_, index) =>
      session(`2026-01-${String(index + 1).padStart(2, '0')}`, 2, index < 6 ? 1 : 0),
    );
    const trend = crashTrend(sessions, 10);
    expect(trend).toHaveLength(3);
    expect(trend[0].rate).toBeCloseTo(6 / ((20 * 300) / 3600));
    expect(trend[2].rate).toBeCloseTo(4 / ((20 * 300) / 3600));
  });
});

describe('daysSinceCrash', () => {
  it('counts the days from the last crash, whatever came after it', () => {
    const log = [session('2025-07-01', 3, 1), session('2025-07-20', 2, 2), session('2025-08-10', 3, 0)];
    expect(daysSinceCrash(log, '2025-08-20')).toBe(31);
  });

  it('is null with no crash at all', () => {
    expect(daysSinceCrash([session('2025-08-10', 3, 0), session('2025-08-11', 2, null)], '2025-08-20')).toBeNull();
  });
});
