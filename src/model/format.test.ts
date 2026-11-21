import {describe, expect, it} from 'vitest';
import {formatTimer, heliSpecs} from './format';

describe('formatTimer', () => {
  it('reads minutes and whole seconds, carrying a rounded 60', () => {
    expect(formatTimer(0)).toBe('0:00');
    expect(formatTimer(306)).toBe('5:06');
    expect(formatTimer(119.6)).toBe('2:00');
    expect(formatTimer(null)).toBe('?');
  });
});

describe('heliSpecs', () => {
  it("says what is known of a heli's size, in one line", () => {
    expect(heliSpecs({sizeClass: '280', rotor: 652, weight: 410})).toBe('280 class · 652 mm rotor · 410 g');
    expect(heliSpecs({rotor: 1240})).toBe('1,240 mm rotor');
    expect(heliSpecs({})).toBe('');
  });
});
