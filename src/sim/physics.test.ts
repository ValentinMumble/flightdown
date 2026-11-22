import {describe, expect, it} from 'vitest';
import {Vector3} from 'three';
import {
  energyAt,
  headingOf,
  heliParams,
  restingState,
  rpmOf,
  step,
  tiltOf,
  type Controls,
  type HeliState,
  type StepEvents,
} from './physics';

const params = heliParams({weight: 345, rotor: 434});
const DT = 1 / 240;
const calm = new Vector3();

/** Flies `seconds` with the same sticks, in still air unless asked, and gathers what happened. */
function fly(state: HeliState, controls: Controls, seconds: number, wind = calm, turbulence = 0) {
  const events: StepEvents[] = [];
  for (let time = 0; time < seconds; time += DT) {
    const happened = step(state, controls, params, wind, DT, turbulence);
    if (Object.keys(happened).length) events.push(happened);
  }
  return events;
}

const hoverThrottle = params.hoverRpm / params.maxRpm;
const hoverStick = params.hoverPitch / params.maxPitch;
const hover: Controls = {roll: 0, pitch: 0, yaw: 0, collective: hoverStick, throttle: hoverThrottle};

/** In the air at a height, the rotor at hover speed. */
function flying(height: number) {
  const state = restingState(new Vector3(0, height, -5));
  state.grounded = false;
  state.energy = energyAt(params.hoverRpm, params);
  return state;
}

describe('the heli', () => {
  it('hovers at hover pitch and head speed', () => {
    const state = flying(3);
    fly(state, hover, 3);
    expect(state.crashed).toBeNull();
    expect(state.position.y).toBeGreaterThan(2.5);
    expect(state.position.y).toBeLessThan(3.5);
    expect(state.velocity.length()).toBeLessThan(0.3);
    expect(rpmOf(state, params)).toBeCloseTo(params.hoverRpm, -2);
  });

  it('hovers upside down at negative hover pitch, the motor working as hard', () => {
    const state = flying(5);
    state.attitude.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
    fly(state, {...hover, collective: -hoverStick}, 3);
    expect(state.crashed).toBeNull();
    expect(state.position.y).toBeGreaterThan(4.5);
    expect(state.position.y).toBeLessThan(5.5);
    expect(state.velocity.length()).toBeLessThan(0.3);
    expect(rpmOf(state, params)).toBeCloseTo(params.hoverRpm, -2);
    const upright = flying(5);
    fly(upright, hover, 3);
    expect(state.power).toBeCloseTo(upright.power, 0);
  });

  it('climbs upside down with full negative pitch', () => {
    const state = flying(5);
    state.attitude.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
    fly(state, {...hover, collective: -1}, 1);
    expect(state.velocity.y).toBeGreaterThan(2);
  });

  it('climbs with more collective and sinks with less', () => {
    const up = flying(3);
    fly(up, {...hover, collective: 0.6}, 1);
    expect(up.velocity.y).toBeGreaterThan(1);
    const down = flying(10);
    fly(down, {...hover, collective: 0}, 1);
    expect(down.velocity.y).toBeLessThan(-1);
  });

  it('spools up on the ground to the head speed asked, with a soft start', () => {
    const state = restingState(new Vector3(0, 0, -5));
    fly(state, {...hover, collective: 0}, 0.25);
    expect(rpmOf(state, params)).toBeLessThan(params.hoverRpm * 0.5);
    fly(state, {...hover, collective: 0}, 1.25);
    expect(rpmOf(state, params)).toBeGreaterThan(params.hoverRpm * 0.95);
    fly(state, {...hover, collective: 0}, 2);
    expect(rpmOf(state, params)).toBeCloseTo(params.hoverRpm, -2);
    expect(state.grounded).toBe(true);
  });

  it('takes off once the collective lifts it', () => {
    const state = restingState(new Vector3(0, 0, -5));
    fly(state, {...hover, collective: 0}, 4);
    const events = fly(state, {...hover, collective: 0.45}, 1.5);
    expect(events.some(event => event.tookOff)).toBe(true);
    expect(state.position.y).toBeGreaterThan(0.3);
  });

  it('coasts down in throttle hold at flat pitch, and stops', () => {
    const state = restingState(new Vector3(0, 0, -5));
    state.energy = energyAt(params.hoverRpm, params);
    fly(state, {...hover, collective: 0, throttle: 0}, 2);
    const rpm = rpmOf(state, params);
    expect(rpm).toBeLessThan(params.hoverRpm * 0.85);
    expect(rpm).toBeGreaterThan(params.hoverRpm * 0.4);
    fly(state, {...hover, collective: 0, throttle: 0}, 2);
    expect(rpmOf(state, params)).toBe(0);
  });

  it('keeps its head speed in an autorotation with low pitch', () => {
    const state = flying(40);
    fly(state, {...hover, collective: -0.15, throttle: 0}, 4);
    expect(state.crashed).toBeNull();
    expect(state.velocity.y).toBeLessThan(-3);
    expect(rpmOf(state, params)).toBeGreaterThan(params.hoverRpm * 0.7);
  });

  it('rolls at the rate the stick asks for', () => {
    const state = flying(20);
    // 240°/s, the servos and the heli a little behind the stick: about 90° after half a second.
    fly(state, {...hover, roll: 1}, 0.5);
    expect((tiltOf(state.attitude) * 180) / Math.PI).toBeGreaterThan(60);
    expect((tiltOf(state.attitude) * 180) / Math.PI).toBeLessThan(115);
  });

  it('turns its nose right with right rudder', () => {
    const state = flying(5);
    fly(state, {...hover, yaw: 0.5}, 0.6);
    const heading = (headingOf(state.attitude) * 180) / Math.PI;
    expect(heading).toBeLessThan(-30);
  });

  it('lands softly with a gentle descent', () => {
    const state = flying(1);
    const events = fly(state, {...hover, collective: hoverStick * 0.85}, 4);
    const landed = events.find(event => event.landed)?.landed;
    expect(state.crashed).toBeNull();
    expect(landed?.speed).toBeLessThan(1);
    expect(state.grounded).toBe(true);
  });

  it('crashes when it hits the ground hard, and stops there', () => {
    const state = flying(6);
    const events = fly(state, {...hover, collective: -1, throttle: 0}, 3);
    expect(events.find(event => event.crashed)?.crashed).toMatch(/^Hit the ground at \d/);
    expect(state.crashed).not.toBeNull();
    expect(state.velocity.length()).toBe(0);
  });

  it('strikes its blades leaning hard near the ground', () => {
    const state = flying(0.15);
    fly(state, {...hover, roll: 1}, 0.5);
    expect(state.crashed).toBe('Blade strike');
  });

  it('never sits still in turbulence, the sticks centred', () => {
    const state = flying(5);
    fly(state, hover, 3, calm, 1);
    expect((tiltOf(state.attitude) * 180) / Math.PI).toBeGreaterThan(1);
  });

  it('raises its nose a little as it gathers speed, what the FBL leaves of the disc blowing back', () => {
    const state = flying(10);
    state.velocity.set(0, 0, -8);
    fly(state, hover, 1);
    const nose = new Vector3(0, 0, -1).applyQuaternion(state.attitude);
    expect(nose.y).toBeGreaterThan(0.02);
    expect(nose.y).toBeLessThan(0.1);
  });

  it('carries its speed once level, as a heli does, and holds a lean when the stick is let go', () => {
    const coasting = flying(20);
    coasting.velocity.set(0, 0, -4);
    fly(coasting, hover, 2);
    expect(-coasting.velocity.z).toBeGreaterThan(2.5);
    const leaning = flying(20);
    fly(leaning, {...hover, pitch: 0.3}, 0.25);
    const lean = tiltOf(leaning.attitude);
    fly(leaning, hover, 2);
    expect(tiltOf(leaning.attitude)).toBeGreaterThan(0.8 * lean);
  });

  it('kicks its tail when the collective is punched', () => {
    const state = flying(5);
    fly(state, hover, 0.5);
    fly(state, {...hover, collective: 1}, 0.15);
    expect(state.rates.y).toBeGreaterThan(0.05);
  });

  it('rights itself and climbs on the rescue, even upside down', () => {
    const state = flying(30);
    state.attitude.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI * 0.95);
    fly(state, {...hover, roll: 0.5, rescue: true}, 1.4);
    expect(tiltOf(state.attitude)).toBeLessThan(0.4);
    fly(state, {...hover, rescue: true}, 1.5);
    expect(state.velocity.y).toBeGreaterThan(0);
    expect(state.crashed).toBeNull();
  });

  it('levels itself in self-level with the cyclic let go, and leans with it held, no negative pitch', () => {
    const state = flying(20);
    state.attitude.setFromAxisAngle(new Vector3(0, 0, 1), 0.6);
    fly(state, {...hover, level: true}, 1);
    expect(tiltOf(state.attitude)).toBeLessThan(0.05);
    fly(state, {...hover, roll: 1, level: true}, 1.5);
    const lean = (tiltOf(state.attitude) * 180) / Math.PI;
    expect(lean).toBeGreaterThan(25);
    expect(lean).toBeLessThan(55);
    const sinking = flying(20);
    fly(sinking, {...hover, collective: -1, level: true}, 0.5);
    expect(sinking.thrust).toBeGreaterThanOrEqual(0);
  });

  it('drifts with the wind', () => {
    const state = flying(5);
    fly(state, hover, 2, new Vector3(5, 0, 0));
    expect(state.velocity.x).toBeGreaterThan(0.3);
  });
});
