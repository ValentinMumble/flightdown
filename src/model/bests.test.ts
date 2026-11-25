import {describe, expect, it} from 'vitest';
import {flipChain, peakAmps, personalBests} from './bests';
import type {Sortie, TelemetrySeries} from '../types';

const sortie = (date: string, packs: number, crashes: number | null, timer = 120) =>
  ({
    id: date + packs,
    date,
    heliId: 'h',
    packs,
    timer,
    crashes,
    telemetry: [],
    broken: [],
    skills: [],
    loggedAt: `${date}T20:00:00`,
  }) as unknown as Sortie;

describe('personal bests', () => {
  it('finds the best day, the longest clean run and the flying days in a row', () => {
    const bests = personalBests(
      [
        sortie('2026-11-01', 3, 0),
        sortie('2026-11-02', 2, 1),
        sortie('2026-11-03', 2, 0),
        sortie('2026-11-03', 2, 0),
        sortie('2026-11-04', 1, null),
        sortie('2026-11-06', 3, 0),
      ],
      new Map(),
    );
    const by = Object.fromEntries(bests.map(best => [best.kind, best]));
    expect(by.cleanRun).toMatchObject({value: 7, date: '2026-11-03', to: '2026-11-06'});
    expect(by.dayPacks).toMatchObject({value: 4, date: '2026-11-03'});
    expect(by.dayAirtime).toMatchObject({value: 480, date: '2026-11-03'});
    expect(by.flyingDays).toMatchObject({value: 4, date: '2026-11-01', to: '2026-11-04'});
    expect(by.inverted).toBeUndefined();
  });
});

describe('a log', () => {
  it('holds its most current over two samples, not a single spike', () => {
    const series = {time: [0, 1, 2, 3], channels: {current: [5, 40, 12, 14]}} as unknown as TelemetrySeries;
    expect(peakAmps(series)).toBe(12);
  });

  it('has no flip chain without flips', () => {
    expect(flipChain({time: [0, 1], channels: {}} as unknown as TelemetrySeries)).toBe(0);
  });
});
