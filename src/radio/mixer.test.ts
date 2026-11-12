import {describe, expect, it} from 'vitest';
import {channelOutput, outputIndex, type MixedModel} from './mixer';

/** The M2 EVO's motor, in short: a flat curve per idle up (FM1 8, FM2 15, FM3 50), held at -100 when L10, reversed. */
const heli: MixedModel = {
  inputs: [{input: 2, source: 'Thr', weight: 100, swtch: 'NONE'}],
  mixes: [
    {
      channel: 2,
      source: 'I2',
      weight: 100,
      offset: 0,
      swtch: 'L3',
      curve: {type: 3, value: 4},
      how: 'ADD',
      name: 'Motor3',
    },
    {
      channel: 2,
      source: 'I2',
      weight: 100,
      offset: 0,
      swtch: 'L2',
      curve: {type: 3, value: 3},
      how: 'REPL',
      name: 'Motor2',
    },
    {
      channel: 2,
      source: 'I2',
      weight: 100,
      offset: 0,
      swtch: 'L1',
      curve: {type: 3, value: 14},
      how: 'REPL',
      name: 'Motor1',
    },
    {channel: 2, source: 'P1', weight: -15, offset: -15, swtch: 'L1', how: 'ADD', name: 'Lower'},
    {
      channel: 2,
      source: 'I2',
      weight: 100,
      offset: 0,
      swtch: 'L10',
      curve: {type: 3, value: 1},
      how: 'REPL',
      name: 'Motor0',
    },
  ],
  curves: [
    {y: [-100, -100]},
    {y: [0, 0, 0, 0, 0]},
    {y: [15, 15]},
    {y: [50, 50]},
    ...Array(9).fill({y: [0, 0]}),
    {y: [8, 8]},
  ],
  reversed: [2],
};
const percent = (value: number) => Math.round(((-value + 1024) / 2048) * 100);

describe('channelOutput', () => {
  const sticks = (source: string) => (source === 'S1' ? -1024 : 0);

  it('follows the idle up on the throttle curves, and holds the motor at L10', () => {
    const at = (switches: string[]) => percent(channelOutput(heli, 2, sticks, name => switches.includes(name)));
    expect(at(['L1'])).toBe(54);
    expect(at(['L2'])).toBe(58);
    expect(at(['L3'])).toBe(75);
    expect(at(['L2', 'L10'])).toBe(0);
  });

  it('lets S1 take up to 30 % off idle up 1', () => {
    const right = (source: string) => (source === 'S1' ? 1024 : 0);
    expect(percent(channelOutput(heli, 2, right, name => name === 'L1'))).toBe(54 - 15);
  });

  it('names outputs from 0 or from 1', () => {
    expect(outputIndex('ch(2)')).toBe(2);
    expect(outputIndex('CH3')).toBe(2);
    expect(outputIndex('SA')).toBeNull();
  });
});
