import {describe, expect, it} from 'vitest';
import type {Battery, Pack, TelemetryLog, TelemetrySeries} from '../types';
import {buttonPack, groupPacks, joinSeries, packUsed} from './packs';

const file = (id: string, start: string | undefined, duration: number, extra: Partial<TelemetryLog> = {}) =>
  ({id, name: `${id}.csv`, start, duration, samples: duration, ...extra}) as TelemetryLog;

describe('groupPacks', () => {
  // The files of 28 Apr 2023: the second pack was logged in two files 5 seconds apart.
  const logs = [
    file('third', '2023-04-28T12:46:01', 161, {mAh: 228, minVoltage: 10.9, maxCurrent: 23.5, avgCurrent: 10}),
    file('first', '2023-04-28T12:18:54', 297, {mAh: 620, minVoltage: 10.41, maxCurrent: 26.1, avgCurrent: 12}),
    file('second', '2023-04-28T12:43:01', 175, {mAh: 368, minVoltage: 10.58, maxCurrent: 23.6, avgCurrent: 7}),
  ];

  it('keeps files a few seconds apart apart when their buttons name two packs', () => {
    const swapped = [
      file('one', '2026-11-12T17:02:07', 263, {packButton: 6}),
      file('two', '2026-11-12T17:06:50', 120, {packButton: 3}),
      file('split', '2026-11-12T17:08:55', 60, {packButton: 3}),
    ];
    expect(groupPacks(swapped).map(pack => pack.files.map(one => one.id))).toEqual([['one'], ['two', 'split']]);
  });

  it('joins files a few seconds apart into one pack, in the order flown', () => {
    const packs = groupPacks(logs);
    expect(packs.map(pack => pack.files.map(one => one.id))).toEqual([['first'], ['second', 'third']]);
  });

  it('sums up a joined pack: its whole span, the lowest voltage, the highest current, the time-weighted average', () => {
    const [, joined] = groupPacks(logs);
    expect(joined).toMatchObject({
      start: '2023-04-28T12:43:01',
      duration: 341,
      mAh: 596,
      minVoltage: 10.58,
      maxCurrent: 23.6,
      samples: 336,
    });
    expect(joined.avgCurrent).toBeCloseTo((7 * 175 + 10 * 161) / 336, 2);
  });

  it('keeps files a pack swap apart as separate packs, and a file with no start on its own at the end', () => {
    const packs = groupPacks([file('alone', undefined, 60), ...logs.slice(1)]);
    expect(packs.map(pack => pack.files.map(one => one.id))).toEqual([['first'], ['second'], ['alone']]);
  });
});

describe('joinSeries', () => {
  const series = (id: string, time: number[], channels: Record<string, number[]>): TelemetrySeries => ({
    id,
    time,
    channels,
  });

  it('places each file at its own start in the pack and keeps the sensors every file has', () => {
    const [pack] = groupPacks([file('one', '2023-04-28T12:43:01', 2), file('two', '2023-04-28T12:43:05', 2)]);
    const joined = joinSeries(pack, [
      series('one', [0, 1, 2], {current: [6, 7, 8], rssi: [90, 90, 90]}),
      series('two', [0, 1, 2], {current: [7, 6, 0]}),
    ]);
    expect(joined.time).toEqual([0, 1, 2, 4, 5, 6]);
    expect(Object.keys(joined.channels)).toEqual(['current']);
    expect(joined.channels.current).toEqual([6, 7, 8, 7, 6, 0]);
  });

  it("carries the radio's mAh count on when the second file starts it again from zero", () => {
    const [pack] = groupPacks([file('one', '2023-04-28T12:43:01', 1), file('two', '2023-04-28T12:43:03', 1)]);
    const joined = joinSeries(pack, [
      series('one', [0, 1], {capacity: [100, 368]}),
      series('two', [0, 1], {capacity: [0, 228]}),
    ]);
    expect(joined.channels.capacity).toEqual([100, 368, 368, 596]);
    expect(packUsed(joined)).toBe(596);
  });
});

describe('buttonPack', () => {
  const kind = (id: string, name: string, packs: Pack[]) =>
    ({id, name, cells: 3, capacity: 700, packs, heliIds: []}) as Battery;
  const batteries = [
    kind('omp', 'OMPHobby 3S 750 mAh 60C', [
      {number: 1, button: 3, since: '2026-11-11', dead: '2026-11-12'},
      {number: 2, button: 4, since: '2026-11-11'},
      {number: 3, dead: '2026-11-11'},
    ]),
    kind('gens', 'Gens Ace 3S 700 mAh 60C', [
      {number: 1, button: 1, since: '2026-11-11'},
      {number: 2, button: 2, since: '2026-11-11', dead: '2026-11-12'},
    ]),
    kind('gens-750', 'Gens Ace 3S 750 mAh', [
      {number: 3, button: 2, since: '2026-11-13'},
      {number: 4, button: 3, since: '2026-11-13'},
    ]),
  ];

  it('names a button by the pack that had it that day, a dead one included', () => {
    expect(buttonPack(2, batteries, '2026-11-12')).toBe('Gens Ace #2');
    expect(buttonPack(3, batteries, '2026-11-12')).toBe('OMPHobby #1');
    expect(buttonPack(2, batteries, '2026-11-10')).toBeNull();
  });

  it("gives a dead pack's button to the pack given it last", () => {
    expect(buttonPack(1, batteries, '2026-11-13')).toBe('Gens Ace #1');
    expect(buttonPack(2, batteries, '2026-11-13')).toBe('Gens Ace #3');
    expect(buttonPack(3, batteries, '2026-11-13')).toBe('Gens Ace #4');
    expect(buttonPack(4, batteries, '2026-11-13')).toBe('OMPHobby #2');
  });
});
