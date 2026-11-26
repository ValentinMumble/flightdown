/**
 * A collective pitch heli for the simulator, flown as a flybarless one is: the cyclic and rudder sticks ask for rates
 * of turn (rate mode, as the M2 EVO's FBL and the K110S's 3D mode), the collective for blade pitch, the throttle for a
 * head speed the governor holds. The rotor's speed comes from its energy: the motor feeds it, lift and drag take from
 * it, a descent with low pitch gives back (autorotation). Thrust grows with head speed squared and the blades' angle of
 * attack, less in a climb, more in a descent and near the ground. All in SI units.
 *
 * World frame: x to the pilot's right, y up, z towards the pilot (the field lies at -z). Body frame: x right, y up, the
 * nose at -z. The heli's position is the bottom of its skids, between them.
 */
import {Quaternion, Vector3} from 'three';

const G = 9.81;
const AIR = 1.225;

/** The sticks, as the radio sends them: -1 to 1, throttle 0 (motor off: cut or hold) to 1. */
export interface Controls {
  /** Right stick right: roll right. */
  roll: number;
  /** Right stick forward: nose down. */
  pitch: number;
  /** Left stick right: nose right. */
  yaw: number;
  /** Left stick up: more pitch. */
  collective: number;
  /** The head speed asked of the governor, as a share of the most it gives. */
  throttle: number;
  /** The rescue, while held: the FBL levels the heli and climbs. */
  rescue?: boolean;
  /** Armed (SA): left out, armed. The throttle is 0 while disarmed. */
  armed?: boolean;
  /** Throttle hold off (SF up), armed or not: left out, read from the throttle. */
  throttleOn?: boolean;
  /** Self-level: the FBL holds the heli level, the cyclic leaning it rather than turning it. */
  level?: boolean;
  /** The rates picked on a game controller or the keyboard (already in the sticks), by name; the radio has its own. */
  rates?: string;
}

export const NO_CONTROLS: Controls = {roll: 0, pitch: 0, yaw: 0, collective: 0, throttle: 0};

export interface HeliParams {
  /** kg, ready to fly. */
  mass: number;
  /** The main rotor's radius, m. */
  radius: number;
  /** Head speed at full throttle, and the one it hovers at with `hoverPitch`, rpm. */
  maxRpm: number;
  hoverRpm: number;
  /** Blade pitch to hover out of ground effect at hover rpm, and the most either way, rad. */
  hoverPitch: number;
  maxPitch: number;
  /** Rates of turn at full stick, rad/s: roll and pitch, then yaw. */
  cyclicRate: number;
  yawRate: number;
  /** The rotor's moment of inertia, kg m². */
  inertia: number;
  /** The most the motor gives, W, and how fast its soft start spools up, rpm a second. */
  maxPower: number;
  spoolRate: number;
  /** Faster than this onto the ground is a crash, m/s. */
  crashSpeed: number;
  /**
   * How hard the disc blows back with airspeed, what the FBL's gyro leaves of it (it holds the attitude the sticks
   * ask for): rad/s of pitch or roll a m/s, at hover thrust. Little, so the heli carries its speed and keeps a lean.
   */
  blowback: number;
}

/**
 * What a heli's calibration flight measured, by its name, over the M2 EVO's numbers. The K110S's (26 Nov 2026, its
 * second pack, marked with SB): hovers at +25 % pitch output on 55 % throttle and +17 % on 70 % (pitch times head
 * speed squared about the same), so about 22 % of full pitch at the 60 % the sim hovers on, 2.7°; three flips and two
 * rolls at full stick in 0.9 to 1.0 s of full output each, about 375°/s; 3 turns each way in 2.0 s of full rudder
 * output, about 535°/s.
 */
const MEASURED: Record<string, Partial<Pick<HeliParams, 'hoverPitch' | 'cyclicRate' | 'yawRate'>>> = {
  K110S: {
    hoverPitch: (2.7 * Math.PI) / 180,
    cyclicRate: (375 * Math.PI) / 180,
    yawRate: (535 * Math.PI) / 180,
  },
};

/** A heli's numbers from its weight (g) and rotor (mm), and what its calibration flight measured: the M2 EVO's else. */
export function heliParams(heli?: {name?: string; weight?: number; rotor?: number}): HeliParams {
  const mass = (heli?.weight ?? 345) / 1000;
  const radius = (heli?.rotor ?? 434) / 2000;
  // Small helis hover at about the same blade tip speed, so a smaller rotor spins faster: 70 m/s at the tips.
  const hoverRpm = (70 / radius) * (60 / (2 * Math.PI));
  const measured = MEASURED[Object.keys(MEASURED).find(name => heli?.name?.startsWith(name)) ?? ''] ?? {};
  return {
    mass,
    radius,
    hoverRpm,
    // The M2 EVO's idle up 2 runs 60 % throttle: hover rpm is 60 % of the most.
    maxRpm: hoverRpm / 0.6,
    // Its hover pitch from its calibration flight (24 Nov 2026), held 10 s in a hover at 1.5 m and marked with SB:
    // 1.80° in idle up 2 (60 %, twice), 2.09° in idle up 1 (54 %, lift growing with head speed squared), on a 500 mAh
    // pack; 1.9° on the usual 700 to 750 mAh ones, a little heavier.
    hoverPitch: (1.9 * Math.PI) / 180,
    maxPitch: (12 * Math.PI) / 180,
    // The FBL's rates at full stick, before the radio's own rates and expo: its calibration flight's 12 flips and rolls
    // at full stick (24 Nov 2026) took 1.0 to 1.3 s each, about 300°/s both ways (the 26 Nov flips agree). The tail:
    // its marked pirouettes (26 Nov 2026), 3 turns each way counted aloud in 1.8 s of full rudder output, about 610°/s.
    cyclicRate: (300 * Math.PI) / 180,
    yawRate: (600 * Math.PI) / 180,
    inertia: 0.015 * mass * radius * radius,
    maxPower: 300 * mass,
    spoolRate: hoverRpm / 1.3,
    crashSpeed: 2.5,
    blowback: 0.006,
    ...measured,
  };
}

export interface HeliState {
  position: Vector3;
  velocity: Vector3;
  /** Body to world. */
  attitude: Quaternion;
  /** Body rates of turn, rad/s. */
  rates: Vector3;
  /** The rotor's kinetic energy, J. */
  energy: number;
  grounded: boolean;
  /** Why it crashed, or null. */
  crashed: string | null;
  /** Thrust (N) and motor power (W) on the last step. */
  thrust: number;
  power: number;
  /** The rates the servos have reached (the sticks', a moment late), rad/s. */
  command: Vector3;
  /** How fast the rates are changing, rad/s²: they settle like a spring. */
  rateChange: Vector3;
  /** The motor's power, smoothed: a sudden rise kicks the tail. */
  steadyPower: number;
  /** Seconds flown, for the turbulence. */
  time: number;
  /** Seconds the rescue has been held. */
  rescueFor: number;
}

/** What a step did. */
export interface StepEvents {
  landed?: {speed: number; at: Vector3};
  tookOff?: boolean;
  crashed?: string;
}

/** The heli on the ground at `at`, its nose `heading` radians left of the field (0: away from the pilot), rotor still. */
export function restingState(at: Vector3, heading = 0): HeliState {
  return {
    position: at.clone(),
    velocity: new Vector3(),
    attitude: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), heading),
    rates: new Vector3(),
    energy: 0,
    grounded: true,
    crashed: null,
    thrust: 0,
    power: 0,
    command: new Vector3(),
    rateChange: new Vector3(),
    steadyPower: 0,
    time: 0,
    rescueFor: 0,
  };
}

const omegaOf = (rpm: number) => (rpm * 2 * Math.PI) / 60;

/** The rotor's speed, rpm. */
export const rpmOf = (state: HeliState, params: HeliParams) =>
  (Math.sqrt((2 * Math.max(0, state.energy)) / params.inertia) * 60) / (2 * Math.PI);

/** The rotor's energy at a speed, J. */
export const energyAt = (rpm: number, params: HeliParams) => 0.5 * params.inertia * omegaOf(rpm) ** 2;

/** Where the rotor hub sits above the skids, in rotor radii (the Huey drawn), and in m. */
export const HUB = 0.53;
export const hubHeight = (params: HeliParams) => HUB * params.radius;

/** The skids' four ends, in the body frame. */
const skids = (params: HeliParams) =>
  [
    [-0.3, -0.5],
    [-0.3, 0.5],
    [0.3, -0.5],
    [0.3, 0.5],
  ].map(([x, z]) => new Vector3(x * params.radius, 0, z * params.radius));

/** The nose's heading, radians left of the field (0: nose away from the pilot), from the attitude. */
export function headingOf(attitude: Quaternion) {
  const nose = new Vector3(0, 0, -1).applyQuaternion(attitude);
  return Math.atan2(-nose.x, -nose.z);
}

/** How far it leans from level, rad. */
export function tiltOf(attitude: Quaternion) {
  const up = new Vector3(0, 1, 0).applyQuaternion(attitude);
  return Math.acos(Math.max(-1, Math.min(1, up.y)));
}

/** Further than this from the pilot, or higher, the heli is out of sight: a crash. */
const RANGE = 150;
const CEILING = 80;
/** The servos follow the sticks with this lag, s. */
const SERVO_LAG = 0.045;
/**
 * The heli follows the servos as a spring settles (rad/s, and its damping): the cyclic in about a sixth of a second
 * with a little overshoot when a turn stops, the tail softer, so it wags.
 */
const CYCLIC_SPRING = {frequency: 13, damping: 0.6};
const TAIL_SPRING = {frequency: 11, damping: 0.42};
/** Thrust builds with the air through the disc over this, s. */
const THRUST_LAG = 0.06;
/** The governor closes the gap to its head speed over this, s: a punch makes the head speed sag first. */
const GOVERNOR = 0.35;
/**
 * The friction in the head and motor would stop the rotor from hover speed in SPIN_DOWN alone, s. Under SLOW (a share
 * of the hover's head speed), below any autorotation's, it brakes BRAKE times harder at a stop (the motor's drag):
 * with the blades' drag it stops in hold in about 3.5 s, and keeps its head speed in an autorotation.
 */
const SPIN_DOWN = 9;
const SLOW = 0.65;
const BRAKE = 8;
/**
 * Drag on the air going by: N for each m/s (the rotor's in-plane drag), and for each (m/s)² (the body and tail).
 */
const DRAG = {linear: 0.01, square: 0.006};
/** The motor's power is smoothed over this, s, to find a sudden rise. */
const POWER_LAG = 0.25;

/**
 * Turbulence: rates of turn (rad/s) and an up and down gust (m/s), each axis a few slow and quick waves added up, so
 * the heli never sits still. Its strength grows with the wind and in the rotor's own wash near the ground.
 */
const WAVES = [
  [0.07, 0.6],
  [0.16, 0.5],
  [0.37, 0.45],
  [0.93, 0.3],
  [2.1, 0.17],
  [4.3, 0.08],
];
const PHASES = [
  0.3, 1.7, 2.9, 4.4, 5.1, 0.8, 3.3, 2.2, 4.9, 1.1, 5.7, 0.5, 2.6, 3.9, 1.4, 4.1, 0.9, 2.4, 3.6, 5.3, 1.9, 4.7, 0.2,
  3.1,
];
function wave(time: number, axis: number) {
  return WAVES.reduce(
    (sum, [frequency, size], index) =>
      sum + size * Math.sin(2 * Math.PI * frequency * time * (1 + axis * 0.13) + PHASES[axis * WAVES.length + index]),
    0,
  );
}

const scratch = {
  up: new Vector3(),
  air: new Vector3(),
  body: new Vector3(),
  inverse: new Quaternion(),
  sky: new Vector3(),
  force: new Vector3(),
  target: new Vector3(),
  axis: new Vector3(),
  turn: new Quaternion(),
  level: new Quaternion(),
  point: new Vector3(),
};

/**
 * Moves the heli on by `dt` seconds (keep it small: 1/240), in a wind (m/s) with `turbulence` (1 as it comes, 0 for
 * still air), and says what happened.
 */
export function step(
  state: HeliState,
  controls: Controls,
  params: HeliParams,
  wind: Vector3,
  dt: number,
  turbulence = 1,
): StepEvents {
  const events: StepEvents = {};
  if (state.crashed) {
    state.energy *= Math.exp(-dt / 0.5);
    state.velocity.set(0, 0, 0);
    state.rates.set(0, 0, 0);
    return events;
  }
  const {mass, radius, inertia} = params;
  const weight = mass * G;
  const area = Math.PI * radius * radius;
  const hoverOmega = omegaOf(params.hoverRpm);
  const omega = Math.sqrt((2 * Math.max(0, state.energy)) / inertia);
  const speed = omega / hoverOmega;
  const up = scratch.up.set(0, 1, 0).applyQuaternion(state.attitude);
  state.time += dt;

  // The air going by, in the body's frame: forward is -z, right +x.
  const air = scratch.air.copy(state.velocity).sub(wind);
  const body = scratch.body.copy(air).applyQuaternion(scratch.inverse.copy(state.attitude).invert());
  const windSpeed = wind.length();
  const hub = state.position.y + up.y * hubHeight(params);
  const wash = state.thrust > 0.3 * weight ? Math.max(0, 1 - hub / (2 * radius)) : 0;
  const rough = turbulence * (0.08 + 0.025 * windSpeed + 0.12 * wash) * Math.min(1, speed);

  // Rates of turn: the FBL asks for the sticks' rates, as far as the head speed lets the swash and tail follow; the
  // servos get there a moment late. On top: turbulence; the disc blowing back from the way it moves (the nose rises
  // with forward speed, it rolls away from a sideways one); the tail turning the nose into a sideways airflow; and a
  // kick of the tail when the motor's power jumps (the rotor turning clockwise, the body is pushed the other way).
  const authority = Math.min(1.2, speed * speed);
  const target = scratch.target.set(
    -controls.pitch * params.cyclicRate * authority,
    -controls.yaw * params.yawRate * Math.min(1, speed),
    -controls.roll * params.cyclicRate * authority,
  );
  // Levelling, in the rescue and self-level: the rates (body frame) that turn the mast back to the sky, faster the
  // further off it is (`gain` a second for each radian off).
  const levelling = (gain: number) => {
    const toSky = scratch.sky.set(-up.z, 0, up.x);
    const off = Math.acos(Math.max(-1, Math.min(1, up.y)));
    // Upside down exactly, any way round will do: it rolls.
    if (toSky.lengthSq() < 1e-6) toSky.set(0, 0, 1).applyQuaternion(state.attitude);
    toSky.normalize().applyQuaternion(scratch.inverse.copy(state.attitude).invert());
    return toSky.multiplyScalar(Math.min(params.cyclicRate, gain * off) * authority);
  };
  // The rescue, while held: whatever the cyclic says, the FBL turns the mast to the sky, the pitch flat, then climbs
  // once upright and held 0.1 s (as the M2 EVO's and the K110S's are set up). The rudder stays the pilot's.
  // Self-level (the M2 EVO's SC): it levels when the cyclic is let go, the cyclic leans it (at 70 % rates, up to about
  // 35° at full stick, where the two balance), and no negative pitch.
  let collective = controls.collective;
  if (controls.rescue) {
    state.rescueFor += dt;
    const back = levelling(6);
    target.x = back.x;
    target.z = back.z;
    collective = up.y > 0.8 && state.rescueFor > 0.1 ? 0.6 : 0;
  } else {
    state.rescueFor = 0;
    if (controls.level) {
      const back = levelling(4);
      target.x = 0.7 * target.x + back.x;
      target.z = 0.7 * target.z + back.z;
      collective = Math.max(0, collective);
    }
  }
  state.command.lerp(target, 1 - Math.exp(-dt / SERVO_LAG));
  const kick = (0.6 * (state.power - state.steadyPower)) / params.maxPower;
  // The disc blows back against the way it moves in proportion to its lift, and the lift's sign turns it round:
  // upside down, the body reacts the other way.
  const blowback = params.blowback * authority * Math.max(-1.5, Math.min(1.5, state.thrust / weight));
  target.set(
    state.command.x + rough * wave(state.time, 0) + blowback * -body.z,
    state.command.y + 0.5 * rough * wave(state.time, 1) - 0.05 * body.x + kick,
    state.command.z + rough * wave(state.time, 2) + blowback * body.x,
  );
  // Sitting on its skids, it cannot lean, and turns only once it is light on them.
  if (state.grounded && state.thrust < 0.8 * weight) {
    target.x = 0;
    target.z = 0;
    if (state.thrust < 0.5 * weight) target.y = 0;
  }
  // The rates follow, as a spring settles.
  const settle = (axis: 'x' | 'y' | 'z', {frequency, damping}: {frequency: number; damping: number}) => {
    state.rateChange[axis] +=
      (frequency * frequency * (target[axis] - state.rates[axis]) - 2 * damping * frequency * state.rateChange[axis]) *
      dt;
    state.rates[axis] += state.rateChange[axis] * dt;
  };
  settle('x', CYCLIC_SPRING);
  settle('y', TAIL_SPRING);
  settle('z', CYCLIC_SPRING);
  const turn = state.rates.length() * dt;
  if (turn > 0) {
    scratch.turn.setFromAxisAngle(scratch.axis.copy(state.rates).normalize(), turn);
    state.attitude.multiply(scratch.turn).normalize();
  }

  // Thrust: the blades' pitch, less the air coming through the disc in a climb (more in a descent, and in a gust
  // from below); more near the ground, and a little more once moving through clean air (translational lift). It
  // builds a moment after the pitch changes.
  const gustUp = turbulence * (0.3 + 0.08 * windSpeed) * wave(state.time, 3);
  const through = air.dot(up) - gustUp;
  const pitch = Math.max(-1, Math.min(1, collective)) * params.maxPitch;
  const attack = Math.max(-0.3, Math.min(0.3, pitch - through / Math.max(1, 0.75 * omega * radius)));
  const groundEffect = 1 + 0.3 * Math.max(0, 1 - hub / (2 * radius)) ** 2;
  const clean = 1 + 0.1 * Math.max(0, Math.min(1, (Math.hypot(body.x, body.z) - 1.5) / 4));
  const lift = weight / (hoverOmega ** 2 * params.hoverPitch);
  const thrust =
    state.thrust +
    (lift * omega * omega * attack * groundEffect * clean - state.thrust) * (1 - Math.exp(-dt / THRUST_LAG));

  // The rotor's energy: the motor, through the governor, against what lift and the blades' drag take.
  const induced = Math.sqrt(Math.abs(thrust) / (2 * AIR * area));
  const profile = 0.25 * weight * Math.sqrt(weight / (2 * AIR * area)) * speed ** 3;
  // The bearings' and the motor's friction: alone, it would stop the rotor from hover speed in SPIN_DOWN, sooner once
  // slow.
  const brake = 1 + BRAKE * Math.max(0, 1 - speed / SLOW);
  const friction = ((inertia * hoverOmega) / SPIN_DOWN) * omega * brake;
  // Lift costs its induced power whichever way it pulls (upside down too); a climb along the thrust costs more, a
  // descent gives back.
  const needed = profile + friction + Math.abs(thrust) * induced + thrust * through;
  let power = 0;
  if (controls.throttle > 0.05) {
    // The soft start: the governor aims no further ahead than its spool rate over the time it takes to close a gap.
    const wanted = Math.min(
      omegaOf(params.maxRpm * Math.min(1, controls.throttle)),
      omega + omegaOf(params.spoolRate) * GOVERNOR,
    );
    const gap = 0.5 * inertia * wanted * wanted - state.energy;
    power = Math.max(0, Math.min(params.maxPower, needed + gap / GOVERNOR));
  }
  state.energy = Math.max(0, state.energy + (power - needed) * dt);
  state.thrust = thrust;
  state.power = power;
  state.steadyPower += (power - state.steadyPower) * (1 - Math.exp(-dt / POWER_LAG));

  // Forces: thrust along the mast, the weight, and drag on the air going by.
  const force = scratch.force.copy(up).multiplyScalar(thrust);
  force.y -= weight;
  const airspeed = air.length();
  force.addScaledVector(air, -(DRAG.linear + DRAG.square * airspeed));
  state.velocity.addScaledVector(force, dt / mass);
  state.position.addScaledVector(state.velocity, dt);

  // The ground: the lowest end of the skids.
  let lowest = Infinity;
  for (const end of skids(params)) {
    lowest = Math.min(lowest, scratch.point.copy(end).applyQuaternion(state.attitude).add(state.position).y);
  }
  const tilt = tiltOf(state.attitude);
  // The disc's lowest tip: a full radius below the hub on its side, none upside down (the disc level again).
  const tipLow = state.position.y + up.y * hubHeight(params) - radius * Math.sin(tilt);
  const crash = (why: string) => {
    state.crashed = why;
    events.crashed = why;
  };
  if (lowest < 0) {
    const impact = -state.velocity.y;
    if (!state.grounded) {
      if (impact > params.crashSpeed) crash(`Hit the ground at ${impact.toFixed(1)} m/s`);
      else if (tilt > (25 * Math.PI) / 180) crash('Touched down leaning over');
      else events.landed = {speed: Math.max(0, impact), at: state.position.clone()};
    } else if (tilt > (60 * Math.PI) / 180) crash('Tipped over');
    state.position.y -= lowest;
    state.velocity.y = Math.max(0, state.velocity.y);
    const slide = Math.exp(-6 * dt);
    state.velocity.x *= slide;
    state.velocity.z *= slide;
    state.grounded = true;
    // Resting on its skids, it settles level on its heading.
    if (thrust < 0.95 * weight) {
      scratch.level.setFromAxisAngle(scratch.axis.set(0, 1, 0), headingOf(state.attitude));
      state.attitude.slerp(scratch.level, 1 - Math.exp(-dt / 0.08));
    }
  } else if (state.grounded && lowest > 0.005) {
    state.grounded = false;
    events.tookOff = true;
  }
  if (!state.crashed && tipLow < 0.02 && omega > 0.2 * hoverOmega) crash('Blade strike');
  const range = Math.hypot(state.position.x, state.position.z);
  if (!state.crashed && (range > RANGE || state.position.y > CEILING)) crash('Flew out of sight');
  return events;
}
