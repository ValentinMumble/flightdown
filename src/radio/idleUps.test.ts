import {describe, expect, it} from 'vitest';
import type {CardMix, CardModel} from './card';
import {idleUpCurves, pitchRange, STICKS, valueAt} from './idleUps';

const mix = (channel: number, source: string, swtch = 'NONE', curve?: number): CardMix => ({
  channel,
  source,
  weight: 100,
  offset: 0,
  swtch,
  how: swtch === 'NONE' ? 'ADD' : 'REPL',
  name: '',
  ...(curve ? {curve: {type: 3, value: curve}} : {}),
});

/**
 * The K110S as set on 23 Nov 2026, in short: a throttle curve an idle up on CH3 (reversed here, as the M2 EVO's is),
 * the pitch on CH6 the stick straight, CPP on practice rates (SG up), and Low RPM's own curve CPL in idle up 1.
 */
const model = {
  id: 'model21',
  name: 'K110S',
  bitmap: '',
  screens: [
    {layout: '', options: {}, zones: [{index: 0, widget: 'K110Cockpit', options: [{type: 'Value', value: 12}]}]},
  ],
  topbar: [],
  topbarWidths: [],
  sensors: [],
  switches: [],
  reversed: [2],
  inputs: [{input: 2, name: 'Thr', source: 'Thr', weight: 100, swtch: 'NONE'}],
  curves: [
    {y: [30, 20, 20, 20, 30]},
    {y: [60, 50, 50, 50, 60]},
    {y: [90, 80, 80, 80, 90]},
    {y: [-60, -7, 15, 37, 59]},
    {y: [-40, -15, 11, 43, 75]},
  ],
  mixes: [
    mix(2, 'I2', 'SE0', 1),
    mix(2, 'I2', 'SE1', 2),
    mix(2, 'I2', 'SE2', 3),
    mix(5, 'I2'),
    mix(5, 'I2', 'SG0', 5),
    mix(5, 'I2', 'SE0', 4),
  ],
} as unknown as CardModel;

describe('idleUpCurves', () => {
  const [low, second, third] = idleUpCurves(model);
  const at = (values: number[], stick: number) => values[STICKS.indexOf(stick)];

  it('reads each idle up throttle the right way up, at mid stick and at the ends', () => {
    expect(at(low.throttle, 0)).toBeCloseTo(60, 0);
    expect(at(low.throttle, 100)).toBeCloseTo(65, 0);
    expect(at(second.throttle, 0)).toBeCloseTo(75, 0);
    expect(at(second.throttle, -100)).toBeCloseTo(80, 0);
    expect(at(third.throttle, 0)).toBeCloseTo(90, 0);
  });

  it('reads the pitch each idle up flies, on full and on practice rates', () => {
    expect([at(low.pitch, -100), at(low.pitch, 0), at(low.pitch, 100)].map(Math.round)).toEqual([-60, 15, 59]);
    // Low RPM keeps its own curve on practice rates.
    expect(at(low.practice, 100)).toBeCloseTo(59, 0);
    expect([at(second.pitch, -100), at(second.pitch, 0), at(second.pitch, 100)].map(Math.round)).toEqual([
      -100, 0, 100,
    ]);
    expect([at(third.practice, -100), at(third.practice, 0), at(third.practice, 100)].map(Math.round)).toEqual([
      -40, 11, 75,
    ]);
  });

  it('reads between the sticks it swept, and the pitch range from the cockpit', () => {
    expect(valueAt(low.pitch, 21)).toBeCloseTo(24.2, 0);
    expect(pitchRange(model)).toBe(12);
  });
});
