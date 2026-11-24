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
 * Tuned by replaying every 2026 log on the physics fitted to the M2 EVO's calibration flight (1.9° hover pitch, 300°/s
 * at full stick, the FBL answering the stick in a straight line: an expo scored worse). None of the M2 EVO's 21 packs
 * crashed for real: they fly 93 % of the time, 18 of them to the end, 124 of their 182 turns made (two hold a third of
 * a stick for seconds while the log shows the heli upright, which a rate FBL cannot do). The K110S's two real crashes
 * come back within 2 s once the stand-in lets go before them (SimView's LET_CRASH).
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

/** A flip or roll read from the log's sticks: the stick's stretch, its axis and way, and how many whole turns it made. */
export interface Manoeuvre {
  from: number;
  to: number;
  axis: 'pitch' | 'roll';
  way: 1 | -1;
  turns: number;
  /** How fast the real heli turned at full stick in it (rad/s): its whole turns spread over the stick's push. */
  rate: number;
}

/** Which way up the pilot flies around a stretch of the log: the sign of the collective's mean, 0 when near nothing. */
const SIDE_FOR = 0.8;
function side(controlsAt: (second: number) => Controls, from: number, to: number): number {
  let sum = 0;
  let count = 0;
  for (let second = from; second <= to; second += 0.05, count++) sum += controlsAt(second).collective;
  const mean = count ? sum / count : 0;
  return Math.abs(mean) < 0.1 ? 0 : Math.sign(mean);
}

/** Under this the stick is at rest, between manoeuvres; a manoeuvre's stick passes `FULL` at least once. */
const QUIET = 0.25;
/** A push of the stick longer than this (s) is not a flip or roll. */
const LONGEST = 10;
const FULL = 0.5;

/**
 * The log's flips and rolls, from its sticks: each push of the cyclic (from rest back to rest, past half stick) that
 * would turn the heli three quarters of a turn or more at `rate` (rad/s at full stick). The real heli came out of each
 * upright, so it made a whole number of turns: the nearest to what the stick asked at the sim's rate.
 */
export function stickManoeuvres(
  series: TelemetrySeries,
  controlsAt: (second: number) => Controls,
  params: Pick<HeliParams, 'cyclicRate'>,
  dt = 0.01,
): Manoeuvre[] {
  const rate = params.cyclicRate;
  const found: Manoeuvre[] = [];
  const end = series.time[series.time.length - 1] ?? 0;
  let run = {from: series.time[0] ?? 0, pitch: 0, roll: 0, peak: 0};
  for (let second = run.from; second <= end; second += dt) {
    const {pitch, roll} = controlsAt(second);
    const size = Math.max(Math.abs(pitch), Math.abs(roll));
    if (size >= QUIET) {
      run.pitch += pitch * rate * dt;
      run.roll += roll * rate * dt;
      run.peak = Math.max(run.peak, size);
      continue;
    }
    // Longer than a manoeuvre: the stick held with the heli down (after a crash), or a slow drift of it.
    if (run.peak >= FULL && second - run.from <= LONGEST) {
      const axis = Math.abs(run.pitch) >= Math.abs(run.roll) ? 'pitch' : 'roll';
      const turns = Math.abs(run[axis]) / (2 * Math.PI);
      // Over to the other side (the collective changes sign, as it does from upright to inverted): half turns.
      const over = side(controlsAt, run.from - SIDE_FOR, run.from) * side(controlsAt, second, second + SIDE_FOR) < 0;
      const made = over
        ? Math.max(0.5, Math.round(turns - 0.5) + 0.5)
        : turns >= 0.75
          ? Math.max(1, Math.round(turns))
          : 0;
      if (made && turns >= 0.3)
        found.push({
          from: run.from,
          to: second,
          axis,
          way: run[axis] > 0 ? 1 : -1,
          turns: made,
          rate: (rate * made) / turns,
        });
    }
    run = {from: second, pitch: 0, roll: 0, peak: 0};
  }
  return found;
}

/** The stick a manoeuvre finishes with when the log let go too soon for the sim heli, and how long it may hold it, s. */
const FINISH_STICK = 0.7;
const FINISH_FOR = 0.8;
/** It lets go this early (rad), the servos and the heli's own spin carrying it the rest of the way. */
const LET_GO = 0.35;
/** It closes the gap to the real heli's turn over this, s. */
const TRACK = 0.25;

/**
 * Flies a replay's flips and rolls as the real heli did them: the sim's rate is not the real heli's to the degree (its
 * head speed, the wind), so the log's stick alone over- or under-turns it. It keeps the log's stick, counts how far the
 * sim heli has turned, lets go once it has made the log's whole turns, and holds a stick on if the log let go before.
 */
export class FlipGuide {
  private current: Manoeuvre | null = null;
  /** How far the real heli had turned (by the log's stick) and the sim heli has, rad. */
  private wanted = 0;
  private turned = 0;
  private doneAt: number | null = null;

  /** The sim heli's rate at full stick, rad/s. */
  private readonly fullRate: number;

  constructor(params: Pick<HeliParams, 'cyclicRate'>) {
    this.fullRate = params.cyclicRate;
  }

  /** The controls for this frame, and whether a manoeuvre is on (the stand-in keeps out). */
  steer(
    controls: Controls,
    state: HeliState,
    second: number,
    dt: number,
    found: Manoeuvre[],
  ): {controls: Controls; manoeuvre: boolean} {
    const now = found.find(one => second >= one.from - 0.2 && second <= one.to + FINISH_FOR);
    if (!now) {
      this.current = null;
      return {controls, manoeuvre: false};
    }
    if (now !== this.current) {
      this.current = now;
      this.wanted = 0;
      this.turned = 0;
      this.doneAt = null;
    }
    if (second < now.from) return {controls, manoeuvre: true};
    const goal = now.turns * 2 * Math.PI;
    // The sim asks -rate for a stick (see physics.ts), so the way the stick pushes is -rate.
    this.turned += -(now.axis === 'pitch' ? state.rates.x : state.rates.z) * now.way * dt;
    const share = Math.max(0, controls[now.axis] * now.way);
    this.wanted = Math.min(goal, this.wanted + share * now.rate * dt);
    if (this.doneAt === null && this.turned >= goal - LET_GO) this.doneAt = second;
    if (this.doneAt !== null) {
      // Done: the stand-in takes it from a moment after, to level it.
      return {controls: {...controls, [now.axis]: 0}, manoeuvre: second - this.doneAt < 0.2};
    }
    // The real heli's turn at this moment: its stick, at its own rate, and a correction for how far behind or ahead the
    // sim heli is, so it goes round in step (the log's collective then lands at the same point of the flip).
    const ahead = second > now.to ? goal : this.wanted;
    const lead = second > now.to ? FINISH_STICK : (share * now.rate) / this.fullRate;
    const stick = clamp(lead + (ahead - this.turned) / TRACK / this.fullRate, 0, 1);
    return {controls: {...controls, [now.axis]: now.way * stick}, manoeuvre: true};
  }
}

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
/** It sets the collective itself to touch down this long before the cut, s. */
const TOUCHDOWN = 4;

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
  if (state.crashed) return logged;
  // The motor cut with the heli sitting, or just above the ground and not sinking hard (a cushion is still the log's):
  // the collective the real pilot raised on the ground would hop the sim heli off on its spinning rotor.
  const sitting = state.grounded || (state.position.y < 2 && state.velocity.y > -1);
  if (logged.throttle <= 0 && sitting) return {...logged, collective: Math.min(logged.collective, 0)};
  if (state.grounded) return logged;
  // A manoeuvre coming: room for it first.
  if (upcoming !== null && tuning.low < tuning.flipHeight) {
    tuning = {...tuning, low: tuning.flipHeight, high: Math.max(tuning.high, tuning.flipHeight + 4)};
  }
  // Landing: the height band slides down to just above the ground as the cut nears.
  if (landing !== null) {
    // On the ground a second before the cut, as the real heli was: the log cuts the motor once it sits.
    const glide = Math.max(0, landing - 1) * GLIDE;
    if (glide < tuning.low) tuning = {...tuning, low: glide, high: Math.min(tuning.high, glide + 0.8)};
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
      collective: clamp(
        collective + (tuning.heightInManoeuvres ? side * heightLift(state, tuning, logged.throttle > 0) : 0),
      ),
    };
  }

  // The attitude it wants: level (upside down, finishing a flip nearer that way), leaning back towards the pad past
  // `reach`, and against the drift.
  // Inverted with the log's collective negative, the pilot was flying inverted: it levels the heli upside down.
  const inverted = up.y < 0 && (hanging || logged.collective < -0.05);
  // The way it wants the thrust: up, leaning back towards the pad and against the drift; the mast along it upright,
  // against it inverted (the blades then push down the mast).
  const want = scratch.want.set(0, 1, 0);
  const away = scratch.away.set(state.position.x - PAD.x, 0, state.position.z - PAD.z);
  const stray = away.length() - tuning.reach;
  if (stray > 0) want.addScaledVector(away.normalize(), -Math.min(tuning.lean, stray * 0.05));
  want.x -= clamp(state.velocity.x * tuning.brake, -tuning.lean, tuning.lean);
  want.z -= clamp(state.velocity.z * tuning.brake, -tuning.lean, tuning.lean);
  want.normalize();
  if (inverted) want.negate();

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

  // Touching down: the last seconds before the log cuts the motor, the real heli was sitting; the stand-in puts the sim
  // heli down on its own collective, sinking gently and slower near the ground.
  if (landing !== null && landing <= TOUCHDOWN && up.y > 0.7) {
    const sink = -Math.min(2, 0.3 + state.position.y * 0.6);
    const hover = params.hoverPitch / params.maxPitch;
    return {...logged, roll, pitch, collective: clamp(hover + (sink - state.velocity.y) * 0.3, -0.3, 0.6)};
  }

  // The height, its collective's sign following which way up the heli is.
  const side = up.y >= 0 ? 1 : -1;
  return {
    ...logged,
    roll,
    pitch,
    collective: clamp(logged.collective + side * heightLift(state, tuning, logged.throttle > 0)),
  };
}

/** The collective (up thrust) bringing the heli back into its height band, and softening a hard sink near the ground. */
function heightLift(state: HeliState, tuning: StandInTuning, powered: boolean) {
  const height = state.position.y;
  const climb = state.velocity.y;
  let lift = 0;
  // The motor cut (hold, or landed): no climbing back into the band on a rotor spinning down, only a hard sink softened.
  if (!powered) return height < 3 && climb < -tuning.sinkLimit ? (-tuning.sinkLimit - climb) * tuning.sinkGain : 0;
  if (height < tuning.low) lift += (tuning.low - height) * tuning.heightGain - Math.min(0, climb) * tuning.climbGain;
  if (height > tuning.high) lift -= (height - tuning.high) * tuning.heightGain + Math.max(0, climb) * tuning.climbGain;
  if (height < 3 && climb < -tuning.sinkLimit) lift += (-tuning.sinkLimit - climb) * tuning.sinkGain;
  return lift;
}
