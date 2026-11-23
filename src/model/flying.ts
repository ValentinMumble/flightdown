/**
 * How a pack was flown, from its log's switches and sticks: the rescues pulled, the time in self-level, on practice
 * rates and in each idle up, how busy the cyclic was, and the current each idle up drew. The switches are the M2 EVO's
 * and the K110S's (src/radio/roles.ts): SC down self-level, SG down practice rates (SD down before 23 Nov 2026), SE the
 * idle up, SH held the rescue.
 */
import type {TelemetrySeries} from '../types';
import {motorRunning} from './telemetry';

/**
 * SD meant something else before the practice rates (practice_rates.py in edge-tx): its time counts from this day. They
 * moved to SG on 23 Nov 2026 (practice_on_sg.py); neither switch has had another job since, so either one down counts.
 */
export const PRACTICE_SINCE = '2026-11-21';

/** A gap between samples longer than this is a gap in the log, not flying time. */
const MAX_STEP = 1.5;
/** Samples further apart than this (seconds) miss the cyclic's quick moves: its travel is not read from them. */
const FAST_LOG = 0.25;

export interface FlyingStats {
  /** Seconds with the motor on. */
  flying: number;
  /** Times the rescue was pulled with the motor on. */
  rescues: number;
  /** Seconds in self-level, the motor on. */
  level: number;
  /** Seconds on practice rates, the motor on; null for a log from before them. */
  practice: number | null;
  /** Seconds in each idle up (SE up, middle, down), the motor on. */
  idleUps: [number, number, number];
  /** The mean current (A) in each idle up, null where it was not flown or no current was logged. */
  amps: [number | null, number | null, number | null];
  /** How far the cyclic stick moves a second, aileron and elevator added (% of its travel each way); null when the log
   * is too slow to say. */
  travel: number | null;
}

/** What a log says of how it was flown, or null when the motor never ran. `day` is the log's (YYYY-MM-DD). */
export function flyingStats(series: TelemetrySeries, day: string): FlyingStats | null {
  const {time, channels} = series;
  const running = motorRunning(channels);
  if (!running.some(Boolean)) return null;
  const at = (channel: string, index: number) => channels[channel]?.[index];
  const steps = time.slice(1).map((second, index) => second - time[index]);
  const fast =
    steps.length > 0 && [...steps].sort((left, right) => left - right)[Math.floor(steps.length / 2)] <= FAST_LOG;
  const stats: FlyingStats = {
    flying: 0,
    rescues: 0,
    level: 0,
    practice: day >= PRACTICE_SINCE && (channels.sd || channels.sg) ? 0 : null,
    idleUps: [0, 0, 0],
    amps: [null, null, null],
    travel: null,
  };
  const charge = [0, 0, 0];
  const charged = [0, 0, 0];
  let moved = 0;
  for (let index = 0; index < time.length - 1; index += 1) {
    if (!running[index]) continue;
    const step = time[index + 1] - time[index];
    if (step <= 0 || step > MAX_STEP) continue;
    stats.flying += step;
    if (at('sh', index) === 1 && at('sh', index - 1) !== 1) stats.rescues += 1;
    if (at('sc', index) === 1) stats.level += step;
    if (stats.practice !== null && (at('sd', index) === 1 || at('sg', index) === 1)) stats.practice += step;
    const switchE = at('se', index);
    if (switchE !== undefined) {
      const idleUp = Math.round(switchE) + 1;
      stats.idleUps[idleUp] += step;
      const amps = at('current', index);
      if (amps !== undefined) {
        charge[idleUp] += amps * step;
        charged[idleUp] += step;
      }
    }
    if (fast && running[index + 1]) {
      for (const stick of ['aileron', 'elevator']) {
        const from = at(stick, index);
        const to = at(stick, index + 1);
        if (from !== undefined && to !== undefined) moved += Math.abs(to - from);
      }
    }
  }
  stats.amps = charge.map((sum, idleUp) =>
    charged[idleUp] >= 10 ? sum / charged[idleUp] : null,
  ) as FlyingStats['amps'];
  if (fast && channels.aileron && stats.flying >= 30) stats.travel = moved / stats.flying;
  return stats;
}
