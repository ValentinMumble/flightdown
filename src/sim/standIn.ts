/**
 * A stand-in pilot for a replayed pack. The log holds the pilot's sticks, but not what the real heli did, so it cannot
 * hold the corrections that answered it: flown open loop, the sim heli drifts off and crashes within seconds. The
 * stand-in adds those corrections back, gently, and only between manoeuvres: it eases the heli back to level (leaning
 * it towards the pad once it strays, against its drift), keeps it at a sane height, and softens a hard sink near the
 * ground. During the log's flips and rolls, and on the ground, the log flies alone.
 */
import {Quaternion, Vector3} from 'three';
import type {TelemetrySeries} from '../types';
import {turnOvers} from '../model/insights';
import type {Controls, HeliParams, HeliState} from './physics';
import {PAD} from './drills';

export interface StandInTuning {
  /** It brings the heli back to its wanted attitude over this, s. */
  attitudeLag: number;
  /** Past this from the pad (m) it leans the heli back towards it, a little more each metre, at most `lean` (rad). */
  reach: number;
  lean: number;
  /** It leans against the heli's drift: rad a m/s. */
  brake: number;
  /** The heights it keeps the heli between (m), and its collective a metre out of them, and a m/s of climb or sink. */
  low: number;
  high: number;
  heightGain: number;
  climbGain: number;
  /** Near the ground (under 3 m), faster than this downwards (m/s) it adds collective, even while the log lands: so
   * much a m/s over it. */
  sinkLimit: number;
  sinkGain: number;
  /** Before a manoeuvre (it knows the log's), it climbs to at least this, m: room for the flip. */
  flipHeight: number;
  /** In a manoeuvre it still keeps the height (collective only); below `bailOut` (m), tilted past 60°, it takes over. */
  heightInManoeuvres: boolean;
  bailOut: number;
  /** In a manoeuvre, the log's collective given as lift the way up the sim heli is. */
  liftFollowsHeli: boolean;
}

/**
 * Tuned by replaying the M2 EVO's November 2026 packs (12, 13 and 20 Nov) on the physics fitted to its calibration flight
 * (1.9° hover pitch, 300°/s at full stick): they fly 52 % of the time before a crash, 77 of their 125 logged flips and
 * rolls happen, and the heli stays between 0.3 and 15 m.
 */
export const STAND_IN: StandInTuning = {
  attitudeLag: 0.3,
  reach: 6,
  lean: 0.25,
  brake: 0.04,
  low: 4,
  high: 12,
  heightGain: 0.3,
  climbGain: 0.21,
  sinkLimit: 1,
  sinkGain: 0.25,
  flipHeight: 9,
  heightInManoeuvres: true,
  bailOut: 2,
  liftFollowsHeli: true,
};

/** The stretches of a log the stand-in keeps out of: its flips and rolls, with a second or so either side. */
export function manoeuvres(series: TelemetrySeries, margin = 1.2) {
  return turnOvers(series).map(turn => ({from: turn.start - margin, to: turn.end + margin}));
}

export const inManoeuvre = (stretches: {from: number; to: number}[], second: number) =>
  stretches.some(({from, to}) => second >= from && second <= to);

/** Seconds until the log's next manoeuvre starts, or null when none does within `ahead`. */
export function untilManoeuvre(stretches: {from: number; to: number}[], second: number, ahead = 4): number | null {
  const next = stretches.find(({from}) => from >= second);
  return next && next.from - second <= ahead ? next.from - second : null;
}

/** When the log cuts the motor (throttle hold or cut), each time: the landings it is about to make. */
export function motorCuts(series: TelemetrySeries, throttleAt: (second: number) => number): number[] {
  const cuts: number[] = [];
  let running = false;
  for (const second of series.time) {
    const on = throttleAt(second) > 0;
    if (running && !on) cuts.push(second);
    running = on;
  }
  return cuts;
}

/** Seconds until the log next cuts the motor, or null when it does not within `ahead`. */
export function untilCut(cuts: number[], second: number, ahead = 8): number | null {
  const next = cuts.find(cut => cut >= second);
  return next !== undefined && next - second <= ahead ? next - second : null;
}

/** Before the log cuts the motor, the stand-in lets the heli down a slope: so high (m) a second before the cut. */
const GLIDE = 0.5;

const clamp = (value: number, low = -1, high = 1) => Math.max(low, Math.min(high, value));
const scratch = {
  up: new Vector3(),
  want: new Vector3(),
  away: new Vector3(),
  axis: new Vector3(),
  inverse: new Quaternion(),
};

/** The log's controls with the stand-in's corrections added; the log's own while `manoeuvre` or on the ground. */
export function standIn(
  logged: Controls,
  state: HeliState,
  params: HeliParams,
  manoeuvre: boolean,
  tuning: StandInTuning = STAND_IN,
  /** Seconds until the log cuts the motor (it is landing), or null. */
  landing: number | null = null,
  /** Seconds until the log's next manoeuvre, or null. */
  upcoming: number | null = null,
): Controls {
  if (state.grounded || state.crashed) return logged;
  // A manoeuvre coming: room for it first.
  if (upcoming !== null && tuning.low < tuning.flipHeight) {
    tuning = {...tuning, low: tuning.flipHeight, high: Math.max(tuning.high, tuning.flipHeight + 4)};
  }
  // Landing: the height band slides down to just above the ground as the cut nears.
  if (landing !== null) {
    const glide = 0.2 + landing * GLIDE;
    if (glide < tuning.low)
      tuning = {...tuning, low: glide, high: Math.max(glide + 1, Math.min(tuning.high, glide + 3))};
  }
  const up = scratch.up.set(0, 1, 0).applyQuaternion(state.attitude);
  // In a manoeuvre the log flies, the height still kept if so tuned; low and leaning over, it takes over all the same.
  const bailing = state.position.y < tuning.bailOut && up.y < 0.5;
  // A flip the sim's heli has not finished when the log's stick lets go (it hangs on its side): the stand-in finishes
  // it, to upright or upside down, whichever is nearer, as the pilot did by feel; inverted flight it leaves be.
  const hanging = manoeuvre && Math.abs(up.y) < 0.7 && Math.abs(logged.roll) < 0.15 && Math.abs(logged.pitch) < 0.15;
  if (manoeuvre && !bailing && !hanging) {
    // The log's pitch meant lift for the way up the real heli was: the sim's flip runs a little ahead of or behind the
    // real one, so the stand-in gives that lift the way up the sim heli is (negative pitch upside down).
    const side = up.y >= 0 ? 1 : -1;
    const collective = tuning.liftFollowsHeli ? side * Math.abs(logged.collective) : logged.collective;
    return {
      ...logged,
      collective: clamp(collective + (tuning.heightInManoeuvres ? side * heightLift(state, tuning) : 0)),
    };
  }

  // The attitude it wants: level (upside down, finishing a flip nearer that way), leaning back towards the pad past
  // `reach`, and against the drift.
  const want = scratch.want.set(0, hanging && up.y < 0 ? -1 : 1, 0);
  const away = scratch.away.set(state.position.x - PAD.x, 0, state.position.z - PAD.z);
  const stray = away.length() - tuning.reach;
  if (stray > 0) want.addScaledVector(away.normalize(), -Math.min(tuning.lean, stray * 0.05));
  want.x -= clamp(state.velocity.x * tuning.brake, -tuning.lean, tuning.lean);
  want.z -= clamp(state.velocity.z * tuning.brake, -tuning.lean, tuning.lean);
  want.normalize();

  // The rate (body frame) turning the mast to it over `attitudeLag`, as cyclic: the sim's stick asks -rate for pitch
  // (body x) and roll (body z).
  const axis = scratch.axis.copy(up).cross(want);
  const angle = Math.atan2(axis.length(), up.dot(want));
  let roll = logged.roll;
  let pitch = logged.pitch;
  if (axis.lengthSq() > 1e-9) {
    axis.normalize().applyQuaternion(scratch.inverse.copy(state.attitude).invert());
    const rate = angle / tuning.attitudeLag / params.cyclicRate;
    pitch = clamp(pitch - axis.x * rate);
    roll = clamp(roll - axis.z * rate);
  }

  // The height, its collective's sign following which way up the heli is.
  const side = up.y >= 0 ? 1 : -1;
  return {...logged, roll, pitch, collective: clamp(logged.collective + side * heightLift(state, tuning))};
}

/** The collective (up thrust) bringing the heli back into its height band, and softening a hard sink near the ground. */
function heightLift(state: HeliState, tuning: StandInTuning) {
  const height = state.position.y;
  const climb = state.velocity.y;
  let lift = 0;
  if (height < tuning.low) lift += (tuning.low - height) * tuning.heightGain - Math.min(0, climb) * tuning.climbGain;
  if (height > tuning.high) lift -= (height - tuning.high) * tuning.heightGain + Math.max(0, climb) * tuning.climbGain;
  if (height < 3 && climb < -tuning.sinkLimit) lift += (-tuning.sinkLimit - climb) * tuning.sinkGain;
  return lift;
}
