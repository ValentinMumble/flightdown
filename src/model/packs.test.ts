import {describe, expect, it} from 'vitest';
import type {TelemetryLog, TelemetrySeries} from '../types';
import {groupPacks, joinSeries, packUsed} from './packs';

const file = (id: string, start: string | undefined, duration: number, extra: Partial<TelemetryLog> = {}) =>
  ({id, name: `${id}.csv`, start, duration, samples: duration, ...extra}) as TelemetryLog;

describe('groupPacks', () => {
  // The files of 28 Apr 2023: the second pack was logged in two files 5 seconds apart.
  const logs = [
    file('third', '2023-04-28T12:46:01', 161, {mAh: 228, minVoltage: 10.9, maxCurrent: 23.5, avgCurrent: 10}),
    file('first', '2023-04-28T12:18:54', 297, {mAh: 620, minVoltage: 10.41, maxCurrent: 26.1, avgCurrent: 12}),
    file('second', '2023-04-28T12:43:01', 175, {mAh: 368, minVoltage: 10.58, maxCurrent: 23.6, avgCurrent: 7}),
  ];

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
