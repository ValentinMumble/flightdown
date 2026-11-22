import {describe, expect, it} from 'vitest';
import type {Battery, Heli} from '../types';
import {buttonValue, drawAmps, emptyFeed, idleUpOf, packFor, packVolts, restingVolts, simSource} from './radioFeed';

const heli = {id: 'm2', name: 'M2 EVO 🟠', battery: undefined} as unknown as Heli;
const battery = (overrides: Partial<Battery>): Battery => ({
  id: 'b',
  name: 'OMPHobby 3S 750 mAh 60C',
  cells: 3,
  capacity: 750,
  packs: [],
  heliIds: ['m2'],
  ...overrides,
});

describe('the pack', () => {
  it('is the heli kind first live pack with a button, else what its battery says', () => {
    const packs = [
      {number: 1, dead: '2026-01-01', button: 1},
      {number: 2, button: 3},
    ];
    expect(packFor(heli, [battery({packs})])).toEqual({cells: 3, capacity: 750, button: 3});
    expect(packFor({...heli, battery: '1S 450 mAh'} as Heli, [])).toEqual({cells: 1, capacity: 450, button: 1});
  });

  it('rests at 4.2 V a cell full and sags under load', () => {
    expect(restingVolts(3, 1)).toBeCloseTo(12.6);
    expect(restingVolts(3, 0.5)).toBeCloseTo(3 * 3.825);
    const pack = {cells: 3, capacity: 750, button: 1};
    expect(packVolts(pack, 0, 10)).toBeCloseTo(12.6 - 0.6);
    expect(packVolts(pack, 600, 0)).toBeLessThan(11.2);
  });

  it('draws about 7 A hovering an M2 EVO in idle up 2, more in idle up 3, none in hold', () => {
    expect(drawAmps(0.345, 0.2, 1, true)).toBeCloseTo(7, 0);
    expect(drawAmps(0.345, 0.15, 1.25, true)).toBeGreaterThan(9.5);
    expect(drawAmps(0.345, 1, 1, false)).toBe(0);
    expect(drawAmps(0.345, -1, 1, true)).toBeCloseTo(drawAmps(0.345, 1, 1, true));
  });
});

describe('what the radio screen reads', () => {
  const feed = {
    ...emptyFeed(),
    controls: {roll: 0.5, pitch: -0.25, yaw: 0, collective: 0.3, throttle: 0.6},
    motor: true,
    idleUp: 3,
    rescue: true,
    volts: 11.4,
    amps: 7,
    used: 120,
    button: 3,
  };

  it('gives the sticks, the switches as flown, the pack button and the telemetry', () => {
    expect(simSource('ail', feed, null)).toBe(512);
    expect(simSource('thr', feed, null)).toBe(307);
    expect(simSource('sa', feed, null)).toBe(1024);
    expect(simSource('sf', feed, null)).toBe(-1024);
    expect(simSource('sf', {...feed, motor: false}, null)).toBe(1024);
    // Disarmed with the throttle on: SF up all the same, as the switch is.
    expect(
      simSource('sf', {...feed, motor: false, controls: {...feed.controls, armed: false, throttleOn: true}}, null),
    ).toBe(-1024);
    expect(simSource('se', feed, null)).toBe(1024);
    expect(simSource('sh', feed, null)).toBe(1024);
    expect(simSource('sc', feed, null)).toBe(-1024);
    expect(simSource('6pos', feed, null)).toBe(buttonValue(3));
    expect(simSource('VFAS', feed, null)).toBe(11.4);
    expect(simSource('mAh', feed, null)).toBe(120);
    expect(simSource('tele(1)', feed, {sensors: ['RSSI', 'Curr']})).toBe(7);
  });

  it('makes the outputs from the sticks, reversed as the model is, or passes the radio own', () => {
    expect(simSource('CH3', feed, null)).toBe(205);
    expect(simSource('CH6', feed, {reversed: [5]})).toBe(-307);
    expect(simSource('CH2', {...feed, outputs: [0, 0.75]}, null)).toBe(768);
  });

  it('reads ch(n) as the card writes it, from 0: the top bar gyro source ch(4) is CH5, not the rudder', () => {
    const outputs = [0, 0, 0, 1, 0.25];
    expect(simSource('ch(4)', {...feed, outputs}, null)).toBe(256);
    expect(simSource('CH5', {...feed, outputs}, null)).toBe(256);
    expect(simSource('ch(3)', {...feed, outputs}, null)).toBe(1024);
  });

  it('finds the idle up from the throttle', () => {
    expect([0.54, 0.6, 0.75].map(idleUpOf)).toEqual([1, 2, 3]);
  });
});
