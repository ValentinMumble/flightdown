import type {TelemetrySeries} from '../types';
import {estimateCells} from './insights';
import {sampleAt} from './telemetry';

/**
 * A LiPo cell's charge against its voltage, at rest: the usual curve, from full (4.20 V) to empty (3.27 V). Under load
 * a cell reads lower, so a charge read from voltage in flight is a low guess.
 */
const CELL_CURVE: [number, number][] = [
  [3.27, 0],
  [3.61, 5],
  [3.69, 10],
  [3.71, 15],
  [3.73, 20],
  [3.75, 25],
  [3.77, 30],
  [3.79, 35],
  [3.8, 40],
  [3.82, 45],
  [3.84, 50],
  [3.85, 55],
  [3.87, 60],
  [3.91, 65],
  [3.95, 70],
  [3.98, 75],
  [4.02, 80],
  [4.08, 85],
  [4.11, 90],
  [4.15, 95],
  [4.2, 100],
];

/** From this a cell is full at rest: 4.10 V allows for the voltage sensor's error (the Cockpit widget's level). */
const FULL_CELL = 4.1;
/** Under this current the motor rests, and the voltage tells the charge. */
const REST_AMPS = 2;

/** A cell's charge in percent from its voltage, along the LiPo curve. */
export function chargeFromCell(volts: number) {
  if (volts <= CELL_CURVE[0][0]) return 0;
  const last = CELL_CURVE[CELL_CURVE.length - 1];
  if (volts >= last[0]) return 100;
  const upper = CELL_CURVE.findIndex(([level]) => level >= volts);
  const [lowVolts, lowCharge] = CELL_CURVE[upper - 1];
  const [highVolts, highCharge] = CELL_CURVE[upper];
  return lowCharge + ((highCharge - lowCharge) * (volts - lowVolts)) / (highVolts - lowVolts);
}

/**
 * The mAh used at each sample: the radio's own count when the log has it, else the current added up over time (amps
 * times seconds, over 3.6), which is how the ESC counts it too.
 */
export function usedMah(series: TelemetrySeries): number[] | null {
  const counted = series.channels.capacity;
  if (counted?.some(value => value > 0)) return counted;
  const current = series.channels.current;
  if (!current?.length) return null;
  const used = [0];
  for (let index = 1; index < current.length; index += 1) {
    const seconds = series.time[index] - series.time[index - 1];
    used.push(used[index - 1] + (((current[index - 1] + current[index]) / 2) * seconds) / 3.6);
  }
  return used;
}

/** The pack's voltage at rest by a moment: its last sample by then with the motor resting, else the one of then. */
function restingVolts(series: TelemetrySeries, second: number): number | null {
  const {voltage, current} = series.channels;
  if (!voltage?.length) return null;
  let found: number | null = null;
  for (let index = 0; index < series.time.length && series.time[index] <= second; index += 1) {
    if (voltage[index] > 0.5 && (current?.[index] ?? 0) < REST_AMPS) found = voltage[index];
  }
  return found ?? sampleAt(series.time, voltage, second);
}

/**
 * The charge a pack started with (%), as the radio's Cockpit takes it: its first voltage at rest, plugged in before
 * the motor spins; full from 4.10 V a cell.
 */
export function startCharge(series: TelemetrySeries, cells: number | undefined): number {
  const {voltage, current} = series.channels;
  const resting = voltage?.findIndex((value, index) => value > 0.5 && (current?.[index] ?? 0) < REST_AMPS) ?? -1;
  const first = resting >= 0 ? voltage?.[resting] : voltage?.find(value => value > 0.5);
  if (first === undefined || !cells) return 100;
  return first / cells >= FULL_CELL ? 100 : chargeFromCell(first / cells);
}

export interface BatteryReading {
  /** Charge left, 0 to 100. */
  left: number;
  /** From the pack's size and the mAh used, or a guess from the cells' voltage. */
  source: 'capacity' | 'voltage';
  /** mAh left, when the pack's size is known. */
  mahLeft?: number;
}

/** How much of the pack is left at a moment of the flight; null when the log says nothing about it. */
export function batteryAt(
  series: TelemetrySeries,
  used: number[] | null,
  second: number,
  pack: {cells?: number; capacity?: number},
): BatteryReading | null {
  const spent = used ? sampleAt(series.time, used, second) : null;
  const voltage = series.channels.voltage;
  const cells = pack.cells ?? (voltage?.length ? estimateCells(Math.max(...voltage)) : undefined);
  // From the pack's size: what it started with, less the mAh used since.
  if (pack.capacity && spent !== null) {
    const mahLeft = Math.max(0, (pack.capacity * startCharge(series, cells)) / 100 - spent);
    return {left: (mahLeft / pack.capacity) * 100, source: 'capacity', mahLeft};
  }
  // Else a guess from the voltage at rest: under load a cell reads lower than its charge.
  const volts = restingVolts(series, second);
  if (!voltage?.length || volts === null) return null;
  return cells ? {left: chargeFromCell(volts / cells), source: 'voltage'} : null;
}
