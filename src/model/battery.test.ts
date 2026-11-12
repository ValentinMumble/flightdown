import {describe, expect, it} from 'vitest';
import type {TelemetrySeries} from '../types';
import {batteryAt, chargeFromCell, usedMah} from './battery';

const series: TelemetrySeries = {
  id: 'log',
  time: [0, 60, 120],
  channels: {current: [10, 10, 20], voltage: [12.6, 11.4, 11.1]},
};

describe('chargeFromCell', () => {
  it('reads a cell along the LiPo curve', () => {
    expect(chargeFromCell(4.2)).toBe(100);
    expect(chargeFromCell(3.84)).toBe(50);
    expect(chargeFromCell(3.0)).toBe(0);
    expect(chargeFromCell(3.81)).toBeCloseTo(42.5);
  });
});

describe('usedMah', () => {
  it('adds the current up over time when the log has no count', () => {
    // 10 A for a minute is 166.7 mAh; then 15 A on average for one more.
    const used = usedMah(series)!;
    expect(used[1]).toBeCloseTo(166.67, 1);
    expect(used[2]).toBeCloseTo(416.67, 1);
  });

  it('keeps the radio’s own count when there is one', () => {
    expect(usedMah({...series, channels: {...series.channels, capacity: [0, 150, 400]}})).toEqual([0, 150, 400]);
  });
});

describe('batteryAt', () => {
  const used = usedMah(series);

  it('counts down the pack from its size', () => {
    const reading = batteryAt(series, used, 60, {cells: 3, capacity: 750});
    expect(reading?.source).toBe('capacity');
    expect(reading?.mahLeft).toBeCloseTo(583.3, 1);
    expect(reading?.left).toBeCloseTo(77.8, 1);
  });

  it('starts from the charge a pack had at rest when plugged in', () => {
    // 11.4 V at rest on 3 cells: 3.8 V a cell, 40 %: 300 mAh of 750, less the 87.5 mAh of the first minute (5.25 A).
    const half = {id: 'log', time: [0, 60, 120], channels: {current: [0.5, 10, 20], voltage: [11.4, 10.9, 10.6]}};
    const reading = batteryAt(half, usedMah(half), 60, {cells: 3, capacity: 750});
    expect(reading?.mahLeft).toBeCloseTo(300 - 87.5, 0);
  });

  it('guesses from the cells’ voltage without a size', () => {
    const reading = batteryAt(series, used, 60, {});
    expect(reading?.source).toBe('voltage');
    // 11.4 V on 3 cells is 3.8 V a cell.
    expect(reading?.left).toBeCloseTo(40);
  });
});
