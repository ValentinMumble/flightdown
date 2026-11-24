import {describe, expect, it} from 'vitest';
import {Vector3} from 'three';
import {heliParams, restingState, step, type Controls} from './physics';
import {FlipGuide, inManoeuvre, standIn, STAND_IN, stickManoeuvres, untilCut, untilManoeuvre} from './standIn';
import type {TelemetrySeries} from '../types';

const params = heliParams({weight: 345, rotor: 434});
const logged: Controls = {roll: 0, pitch: 0, yaw: 0, collective: 0.2, throttle: 0.6};

/** In the air at a height, leaning `lean` rad about the body's roll axis (z). */
function flying(height: number, lean = 0) {
  const state = restingState(new Vector3(0, height, -5));
  state.grounded = false;
  state.attitude.setFromAxisAngle(new Vector3(0, 0, 1), lean);
  return state;
}

describe('the stand-in pilot', () => {
  it('leaves the log alone on the ground', () => {
    expect(standIn(logged, restingState(new Vector3(0, 0, -5)), params, false)).toEqual(logged);
  });

  it('eases a leaning heli back to level between manoeuvres', () => {
    // Leaning left (rolled the positive way about z): it adds right roll.
    const corrected = standIn(logged, flying(6, 0.3), params, false);
    expect(corrected.roll).toBeGreaterThan(0.1);
  });

  it('keeps its hands off the cyclic in a flip, the lift following the way up the heli is', () => {
    const upsideDown = flying(8, Math.PI);
    const inFlip = standIn({...logged, roll: 0.8, collective: 0.3}, upsideDown, params, true);
    expect(inFlip.roll).toBe(0.8);
    expect(inFlip.collective).toBeLessThan(0);
  });

  it('finishes a flip hanging on its side once the stick lets go', () => {
    const corrected = standIn(logged, flying(8, 1.4), params, true);
    expect(Math.abs(corrected.roll)).toBeGreaterThan(0.1);
  });

  it('climbs when low, and before a manoeuvre to its flip height', () => {
    expect(standIn(logged, flying(2), params, false).collective).toBeGreaterThan(logged.collective);
    const before = standIn(logged, flying(6), params, false, STAND_IN, null, 2);
    expect(before.collective).toBeGreaterThan(standIn(logged, flying(6), params, false).collective);
  });

  it('knows what the log does next', () => {
    const stretches = [{from: 10, to: 14}];
    expect(inManoeuvre(stretches, 12)).toBe(true);
    expect(untilManoeuvre(stretches, 7)).toBe(3);
    expect(untilManoeuvre(stretches, 2)).toBeNull();
    expect(untilCut([100], 95)).toBe(5);
    expect(untilCut([100], 50)).toBeNull();
  });

  it('reads the flips and rolls from the sticks, as whole turns', () => {
    const series = {time: [0, 10], channels: {}} as unknown as TelemetrySeries;
    // A back flip at 1.3 s of full stick (390° at 300°/s), a roll right at 1.1 s, and a long nudge of the stick.
    const controlsAt = (second: number): Controls => ({
      ...logged,
      pitch: second >= 1 && second < 2.3 ? -1 : second >= 6 && second < 8 ? 0.3 : 0,
      roll: second >= 4 && second < 5.1 ? 1 : 0,
    });
    const found = stickManoeuvres(series, controlsAt, params);
    expect(found.map(({axis, way, turns}) => ({axis, way, turns}))).toEqual([
      {axis: 'pitch', way: -1, turns: 1},
      {axis: 'roll', way: 1, turns: 1},
    ]);
    expect(found[0].from).toBeCloseTo(1, 1);
  });

  it('flies a flip to one whole turn, whatever the stick held', () => {
    const flip = {from: 1, to: 2.5, axis: 'pitch' as const, way: -1 as const, turns: 1, rate: params.cyclicRate / 1.25};
    const state = flying(12);
    const guide = new FlipGuide(params);
    const dt = 1 / 240;
    let turned = 0;
    for (let second = 0; second < 4; second += dt) {
      // The log holds the stick 1.5 s, a turn and a quarter at the sim's rate.
      const log = {...logged, collective: 0.16, pitch: second >= flip.from && second < flip.to ? -1 : 0};
      const {controls} = guide.steer(log, state, second, dt, [flip]);
      step(state, controls, params, new Vector3(), dt, 1);
      turned += state.rates.x * dt;
    }
    expect(turned / (2 * Math.PI)).toBeGreaterThan(0.9);
    expect(turned / (2 * Math.PI)).toBeLessThan(1.1);
  });

  it('keeps a settled heli down once the motor is cut, whatever the collective', () => {
    const sitting = restingState(new Vector3(0, 0, -5));
    expect(standIn({...logged, collective: 0.8, throttle: 0}, sitting, params, false).collective).toBeLessThanOrEqual(
      0,
    );
    // Sinking hard, the log's collective is a cushion: left as it is.
    const falling = flying(1.5);
    falling.velocity.set(0, -3, 0);
    expect(standIn({...logged, collective: 0.8, throttle: 0}, falling, params, false).collective).toBeGreaterThan(0.5);
  });
});
