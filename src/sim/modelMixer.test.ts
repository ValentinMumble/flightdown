import {describe, expect, it} from 'vitest';
import type {CardMix, CardModel} from '../radio/card';
import {readAxes} from './input';
import {ModelMixer, radioSource, type RadioState} from './modelMixer';

const mix = (channel: number, source: string, weight = 100, swtch = 'NONE'): CardMix => ({
  channel,
  source,
  weight,
  offset: 0,
  swtch,
  how: 'ADD',
  name: '',
});

/** A small heli model: practice rates on SD down for the aileron, the throttle cut in hold, CH2 and CH6 reversed. */
const model = {
  id: 'model1',
  name: 'Test',
  bitmap: '',
  screens: [],
  topbar: [],
  topbarWidths: [],
  sensors: [],
  switches: [],
  reversed: [1, 5],
  inputs: [
    {input: 0, name: 'Prac', source: 'Ail', weight: 70, swtch: 'SD2'},
    {input: 0, name: 'Ail', source: 'Ail', weight: 100, swtch: 'NONE'},
    {input: 1, name: 'Ele', source: 'Ele', weight: 100, swtch: 'NONE'},
    {input: 2, name: 'Thr', source: 'Thr', weight: 100, swtch: 'NONE'},
    {input: 3, name: 'Rud', source: 'Rud', weight: 100, swtch: 'NONE'},
  ],
  mixes: [
    mix(0, 'I0'),
    mix(1, 'I1'),
    // The motor: 60 % throttle (MAX at 20 %), cut to -100 % in hold (SF down).
    mix(2, 'MAX', 20),
    {...mix(2, 'MAX', -100, 'SF2'), how: 'REPL'},
    mix(3, 'I3'),
    mix(5, 'I2'),
  ],
} as unknown as CardModel;

const state = (change: Partial<RadioState>): RadioState => ({
  ail: 0,
  ele: 0,
  rud: 0,
  thr: 0,
  armed: true,
  motor: true,
  idleUp: 2,
  level: false,
  practice: false,
  rescue: false,
  button: 1,
  ...change,
});

describe('the model mixer', () => {
  const mixer = new ModelMixer(model, 0.3);

  it('reads the switches as flown', () => {
    expect(radioSource(state({}), 'SA')).toBe(1024);
    expect(radioSource(state({motor: false}), 'SF')).toBe(1024);
    expect(radioSource(state({idleUp: 1}), 'SE')).toBe(-1024);
    expect(radioSource(state({practice: true}), 'SD')).toBe(1024);
    expect(radioSource(state({ail: 0.5}), 'Ail')).toBe(512);
  });

  it('makes the outputs through the model: its practice rates, its hold, its reversals', () => {
    const outputs = mixer.outputs(state({ail: 0.5, ele: 0.5, thr: 0.4}), 1);
    expect(outputs[0]).toBeCloseTo(0.5, 2);
    expect(outputs[1]).toBeCloseTo(-0.5, 2);
    expect(outputs[2]).toBeCloseTo(0.2, 2);
    expect(outputs[5]).toBeCloseTo(-0.4, 2);
    expect(mixer.outputs(state({ail: 0.5, practice: true}), 2)[0]).toBeCloseTo(0.35, 2);
    expect(mixer.outputs(state({motor: false}), 3)[2]).toBeCloseTo(-1, 2);
    // Read back through the model's reversals, the sim gets the sticks' sense.
    const controls = readAxes(outputs, mixer.mapping);
    expect(controls.roll).toBeCloseTo(0.5, 2);
    expect(controls.pitch).toBeCloseTo(0.5, 2);
    expect(controls.collective).toBeCloseTo(0.4, 2);
    expect(controls.throttle).toBeCloseTo(0.6, 2);
  });

  it('finds the collective stick that gives hover pitch, upright and upside down', () => {
    expect(mixer.hover.upright).toBeCloseTo(0.3, 2);
    expect(mixer.hover.inverted).toBeCloseTo(-0.3, 2);
  });
});
