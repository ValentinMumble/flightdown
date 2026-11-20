import {describe, expect, it} from 'vitest';
import {ModelTimers, type Read, type TimedModel} from './timers';

/** The M2 EVO's timer 1: counts down from 4:40 while the motor is on, armed (SA down) and out of hold (SF up). */
const heli: TimedModel = {
  timers: [{start: 280, swtch: '!L10', mode: 'ON'}],
  logicalSwitches: {
    3: {func: 'FUNC_VPOS', def: 'SF,0', andsw: 'NONE', delay: 0},
    4: {func: 'FUNC_VNEG', def: 'SA,1', andsw: 'NONE', delay: 0},
    9: {func: 'FUNC_OR', def: 'L4,L5', andsw: 'NONE', delay: 0},
    15: {func: 'FUNC_AND', def: '!TELEMETRY_STREAMING,L5', andsw: 'NONE', delay: 0},
  },
  timerResets: [{swtch: 'L16', timer: 0}],
  sensors: ['RSSI'],
  precisions: [0],
};

/** A pack: armed and telemetry from the start, in hold until 10 s, the motor on from 10 s to 70 s, then hold. */
const pack =
  (second: number): Read =>
  source =>
    source === 'tele(0)'
      ? 60
      : source === 'SA'
        ? 1024
        : source === 'SF'
          ? second >= 10 && second < 70
            ? -1024
            : 1024
          : -1024;

describe('ModelTimers', () => {
  it('runs a throttle-relative timer as fast as its throttle source is open (the K110S: CH9)', () => {
    const k110s = new ModelTimers(
      {timers: [{start: 240, swtch: 'NONE', mode: 'THR_REL'}], sensors: [], throttleSource: 'ch(8)'},
      0,
    );
    // CH9 at 50 % open (0 on -1024 to 1024) for 20 s, then full for 10 s: 10 s and 10 s counted.
    k110s.advance(30, second => source => (source === 'ch(8)' ? (second <= 20 ? 0 : 1024) : 0));
    expect(k110s.value(0)).toBe(240 - 20);
  });

  it('does not step again from inside a step when its throttle source asks the timers (the mixer making CH9)', () => {
    const timers = new ModelTimers(
      {timers: [{start: 240, swtch: 'NONE', mode: 'THR_REL'}], sensors: [], throttleSource: 'ch(8)'},
      0,
    );
    const read =
      (second: number): Read =>
      source => {
        if (source === 'ch(8)') timers.advance(second, read);
        return source === 'ch(8)' ? 1024 : 0;
      };
    timers.advance(10, read);
    expect(timers.value(0)).toBe(230);
  });

  it('runs a THR timer only while the throttle is off its stop', () => {
    const thr = new ModelTimers({timers: [{start: 0, swtch: 'NONE', mode: 'THR'}], sensors: []}, 0);
    thr.advance(10, second => source => (source === 'Thr' ? (second <= 4 ? -1024 : 0) : 0));
    expect(thr.value(0)).toBe(6);
  });

  it('counts down from its start only while its switch is on: the motor on', () => {
    const timers = new ModelTimers(heli, 0);
    timers.advance(10, pack);
    expect(timers.value(0)).toBe(280);
    timers.advance(100, pack);
    expect(timers.value(0)).toBe(280 - 60);
  });

  it('counts again from the start of a replay taken back', () => {
    const timers = new ModelTimers(heli, 0);
    timers.advance(100, pack);
    timers.advance(40, pack);
    expect(timers.value(0)).toBe(280 - 30);
  });

  it('starts again when telemetry stops while disarmed (L16)', () => {
    const timers = new ModelTimers(heli, 0);
    timers.advance(100, pack);
    timers.advance(101, () => source => (source === 'SA' ? -1024 : 0));
    expect(timers.value(0)).toBe(280);
  });

  it('reads the switches again while its clock stands still: a switch moved by hand in a paused replay', () => {
    const timers = new ModelTimers(heli, 0);
    timers.advance(5, () => source => (source === 'SA' ? 0 : -1024));
    expect(timers.isOn('L10')).toBe(true);
    timers.advance(5, () => source => (source === 'SA' ? 1024 : -1024));
    expect(timers.isOn('L10')).toBe(false);
    expect(timers.value(0)).toBe(280);
  });

  it('turns a logical switch on only once its condition has held for its delay', () => {
    const delayed = new ModelTimers({
      timers: [{start: 0, swtch: 'L1', mode: 'ON'}],
      logicalSwitches: {0: {func: 'FUNC_VPOS', def: 'SB,0', andsw: 'NONE', delay: 20}},
      sensors: [],
    });
    delayed.advance(0, () => () => 1024);
    delayed.advance(10, () => () => 1024);
    expect(delayed.value(0)).toBe(8);
  });
});
