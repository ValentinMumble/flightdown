import {describe, expect, it} from 'vitest';
import {Vector3} from 'three';
import {heliParams, restingState, type Controls} from './physics';
import {inManoeuvre, standIn, STAND_IN, untilCut, untilManoeuvre} from './standIn';

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
});
