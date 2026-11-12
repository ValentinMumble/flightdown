import {describe, expect, it} from 'vitest';
import type {CardModel} from './card';
import {connected, describeCondition, describeFunction, describeLogic} from './logic';

/** The M2 EVO in short: arm, hold, the motor held while off, a low-pack alarm, a sound on SA, the volume on S2. */
const heli: CardModel = {
  id: 'model20',
  name: 'M2 EVO',
  bitmap: '',
  screens: [],
  topbar: [],
  topbarWidths: [],
  sensors: ['RSSI', '', '', '', 'Curr', 'VFAS'],
  precisions: [0, 0, 0, 0, 1, 2],
  switches: ['SA', 'SF'],
  logicalSwitches: {
    3: {func: 'FUNC_VPOS', def: 'SF,0', andsw: 'NONE', delay: 0},
    4: {func: 'FUNC_VPOS', def: 'SA,-1', andsw: 'NONE', delay: 0},
    9: {func: 'FUNC_OR', def: 'L4,L5', andsw: 'NONE', delay: 0},
    13: {func: 'FUNC_AND', def: 'L4,L5', andsw: 'NONE', delay: 0},
    14: {func: 'FUNC_VNEG', def: 'tele(5),1050', andsw: 'NONE', delay: 20},
  },
  timers: [{start: 0, swtch: '!L10', mode: 'ON'}],
  inputNames: ['', '', 'Thr'],
  inputs: [{input: 2, source: 'Thr', weight: 100, swtch: 'NONE'}],
  mixes: [
    {
      channel: 2,
      source: 'I2',
      weight: 100,
      offset: 0,
      swtch: 'NONE',
      curve: {type: 3, value: 1},
      how: 'ADD',
      name: 'Motor',
    },
    {channel: 2, source: 'MAX', weight: -100, offset: 0, swtch: 'L10', how: 'REPL', name: 'Held'},
  ],
  curveNames: ['FM1'],
  functions: [
    {swtch: 'SA0', func: 'PLAY_TRACK', def: 'armed,1,1x'},
    {swtch: 'L15', func: 'PLAY_TRACK', def: 'lowbat,1,15'},
  ],
};

describe('describeCondition', () => {
  it('puts switches, sensors and joins in words', () => {
    const logical = heli.logicalSwitches!;
    expect(describeCondition(logical[3], heli)).toBe('SF down');
    expect(describeCondition(logical[4], heli)).toBe('SA not up');
    expect(describeCondition(logical[9], heli)).toBe('hold or disarmed');
    expect(describeCondition(logical[14], heli)).toBe('VFAS below 10.5, for 2 s');
  });
});

describe('describeFunction', () => {
  it('reads the settings of both file formats, and whether the function is on', () => {
    expect(describeFunction({swtch: 'SA0', func: 'PLAY_TRACK', def: 'armed,1,1x'}, heli)).toEqual({
      text: 'says "armed"',
      active: true,
    });
    expect(describeFunction({swtch: 'SA0', func: 'PLAY_TRACK', def: 'armed,1x'}, heli).text).toBe('says "armed"');
    expect(describeFunction({swtch: 'L16', func: 'RESET', def: 'Tmr1,1'}, heli).text).toBe('resets timer 1');
    expect(describeFunction({swtch: 'ON', func: 'BACKLIGHT', def: 'SL2,0'}, heli)).toEqual({
      text: 'sets the backlight from right slider',
      active: false,
    });
  });
});

describe('describeLogic', () => {
  const view = describeLogic(heli, {functions: [{swtch: 'ON', func: 'VOLUME', def: 'P3,1'}], batteryWarning: 6.6});

  it('lays out the controls, conditions, channels and actions, sounds kept with their switch', () => {
    expect(view.controls.map(item => item.id)).toEqual(['SA', 'SF', 'sticks', 'S2', 'telemetry']);
    expect(view.controls[0].detail).toBe('says up: "armed"');
    expect(view.channels[0].lines.map(line => `${line.how} ${line.text} ${line.label}`)).toEqual([
      '+ Thr, curve FM1 ',
      '= full -100% motor off',
    ]);
    expect(view.actions.map(item => item.id)).toEqual(['T1', 'F2', 'G1', 'battery']);
  });

  it('marks what nothing reads, and what only the radio reads', () => {
    expect(view.conditions.find(item => item.id === 'L14')?.unused).toBe(true);
    expect(view.controls.find(item => item.id === 'S2')?.radioWide).toBe(true);
  });

  it('lights everything a switch leads to, and what it comes from', () => {
    expect([...connected(view, 'SF')].sort()).toEqual(['CH3', 'L10', 'L14', 'L4', 'SF', 'T1']);
    expect([...connected(view, 'L10')].sort()).toEqual(['CH3', 'L10', 'L4', 'L5', 'SA', 'SF', 'T1']);
  });
});
