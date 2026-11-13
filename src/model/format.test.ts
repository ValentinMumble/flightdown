import {describe, expect, it} from 'vitest';
import {formatTimer} from './format';

describe('formatTimer', () => {
  it('reads minutes and whole seconds, carrying a rounded 60', () => {
    expect(formatTimer(0)).toBe('0:00');
    expect(formatTimer(306)).toBe('5:06');
    expect(formatTimer(119.6)).toBe('2:00');
    expect(formatTimer(null)).toBe('?');
  });
});
