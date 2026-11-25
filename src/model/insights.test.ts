import {describe, expect, it} from 'vitest';
import {packResistance} from './insights';

describe('packResistance', () => {
  it('reads how far the volts fall an amp over the whole flight, while the pack drains under it', () => {
    // A 3S pack of 60 mΩ flown 4 minutes: its resting volts fall from 12.4 to 11.2 as it drains, the current swings
    // between 6 and 22 A.
    const time = Array.from({length: 1200}, (_, index) => index * 0.2);
    const current = time.map(second => 14 + 8 * Math.sin(second * 1.3));
    const voltage = time.map((second, index) => 12.4 - (1.2 * second) / 240 - 0.06 * current[index]);
    const resistance = packResistance({id: 'pack', time, channels: {voltage, current}});
    expect(resistance).toBeCloseTo(60, 0);
  });

  it('reads nothing from a log whose current never swings', () => {
    const time = Array.from({length: 600}, (_, index) => index * 0.2);
    const current = time.map(() => 8);
    const voltage = time.map(second => 12.4 - second / 200);
    expect(packResistance({id: 'hover', time, channels: {voltage, current}})).toBeNull();
  });
});
