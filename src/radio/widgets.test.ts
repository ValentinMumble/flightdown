import {describe, expect, it} from 'vitest';
import {guessSignal, packSignals, radioName, sourceValue, widgetName} from './widgets';

describe('widgetName', () => {
  it('reads the name the widget registers, not a field of the same name', () => {
    expect(widgetName('local Point = {}\nPoint.name = "Point"\nlocal name = "ArmedModel"\n', 'armed-model.lua')).toBe(
      'ArmedModel',
    );
    expect(widgetName('local NAME = "Battery"\n', 'battery.lua')).toBe('Battery');
    expect(widgetName('Point.name = "Point"\n', 'tetris.lua')).toBe('tetris');
  });
});

describe('radioName', () => {
  it('drops what the radio cannot print', () => {
    expect(radioName('M2 EVO 🟠')).toBe('M2 EVO');
  });
});

describe('sourceValue', () => {
  const series = {
    id: 'pack',
    time: [0, 1, 2],
    channels: {voltage: [12.4, 11.9, 11.2], throttle: [0, 50, 100], rudder: [-100, 0, 50]},
  };

  it('gives a sensor in its own unit, at the sample of that moment', () => {
    expect(sourceValue(series, 'voltage', 0)).toBe(12.4);
    expect(sourceValue(series, 'voltage', 1.5)).toBe(11.9);
    expect(sourceValue(series, 'voltage', 9)).toBe(11.2);
  });

  it('gives sticks from -1024 to 1024, as the radio does', () => {
    expect([0, 1, 2].map(second => sourceValue(series, 'throttle', second))).toEqual([-1024, 0, 1024]);
    expect([0, 1, 2].map(second => sourceValue(series, 'rudder', second))).toEqual([-1024, 0, 512]);
  });

  it('gives 0 for a channel the pack does not have', () => {
    expect(sourceValue(series, 'current', 1)).toBe(0);
  });

  it('adds up the current into mAh used when the log has no mAh sensor, as the radio does', () => {
    const flown = {id: 'old', time: [0, 1800, 3600], channels: {current: [1, 1, 1]}};
    expect(packSignals(flown)).toContain('capacity');
    expect([0, 1800, 3600].map(second => sourceValue(flown, 'capacity', second))).toEqual([0, 500, 1000]);
  });

  it('gives the outputs, logged in µs, from -1024 to 1024 whichever way a source names them', () => {
    const outputs = {id: 'pack', time: [0], channels: {ch1: [1500], ch5: [2012]}};
    const signals = packSignals(outputs);
    expect(guessSignal('ch(4)', signals)).toBe('ch5');
    expect(guessSignal('CH1', signals)).toBe('ch1');
    expect(guessSignal('ch(2)', signals)).toBe('');
    expect(sourceValue(outputs, 'ch1', 0)).toBe(0);
    expect(sourceValue(outputs, 'ch5', 0)).toBe(1024);
  });
});

describe('guessSignal', () => {
  const signals = packSignals({id: 'pack', time: [0], channels: {voltage: [12], current: [1], capacity: [0]}});

  it('lets arming and throttle-cut switches follow the rotor, and sensors their channel', () => {
    expect(guessSignal('ArmedSwitch', signals)).toBe('running');
    expect(guessSignal('ThrottleCutSwitch', signals)).toBe('running');
    expect(guessSignal('Voltage', signals)).toBe('voltage');
    expect(guessSignal('VFAS', signals)).toBe('voltage');
    expect(guessSignal('Current', signals)).toBe('current');
    expect(guessSignal('mAh', signals)).toBe('capacity');
  });

  it('leaves a source set by hand when the pack has nothing for it', () => {
    expect(guessSignal('RSSI', signals)).toBe('');
    expect(guessSignal('SA', signals)).toBe('');
    expect(guessSignal('ArmedSwitch', [])).toBe('');
  });
});

describe('the rotor turning', () => {
  const series = {id: 'pack', time: [0, 1, 2, 3], channels: {current: [0.4, 1.9, 12, 0.8], throttle: [0, 20, 60, 0]}};

  it('is up (-1024) while the pack draws 2 A or more, down otherwise', () => {
    expect([0, 1, 2, 3].map(second => sourceValue(series, 'running', second))).toEqual([1024, 1024, -1024, 1024]);
  });

  it('follows the throttle stick when the log has no current', () => {
    const throttleOnly = {...series, channels: {throttle: [0, 20, 60, 0]}};
    expect([0, 1, 2, 3].map(second => sourceValue(throttleOnly, 'running', second))).toEqual([
      1024, -1024, -1024, 1024,
    ]);
  });
});
