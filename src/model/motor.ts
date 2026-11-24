import type {TelemetrySeries} from '../types';

/** From this current the motor works under load: the heli is in the air (2 A, as the radio's Session widget). */
const FLYING_AMPS = 2;
/** How far (µs) the motor's output strays from cut before it counts as on: past the output's jitter. */
const MOTOR_SLACK = 20;
/** An output's ends (µs), -100 % and +100 %: a motor cut sits at one of them. */
const CUT_ENDS = [988, 2012];

/** The value a list holds most often. */
function mostFrequent(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((left, right) => right[1] - left[1])[0][0];
}

/**
 * Whether the motor runs at each sample: its output (CH3) away from where it sits cut (its value while the pack draws
 * nothing), as the radio's PACK timer counts it; in a log with no outputs, the pack under load, as the Session widget
 * counts it.
 */
export function motorRunning(channels: TelemetrySeries['channels']): boolean[] {
  const motor = channels.ch3;
  const currents = channels.current ?? [];
  if (motor?.length) {
    const idle = currents.length ? motor.filter((_, index) => (currents[index] ?? 0) < 0.5) : [];
    if (idle.length) {
      const cut = mostFrequent(idle);
      return motor.map(value => Math.abs(value - cut) > MOTOR_SLACK);
    }
    // No current to tell (the K110S has no telemetry, and logs only once its motor may run): the motor is cut at an
    // end of the output's travel (-100 %, or +100 % on a reversed channel), where a running one never sits.
    return motor.map(value => value > CUT_ENDS[0] + MOTOR_SLACK && value < CUT_ENDS[1] - MOTOR_SLACK);
  }
  return currents.map(value => value >= FLYING_AMPS);
}
