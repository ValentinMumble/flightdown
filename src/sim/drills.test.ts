import {describe, expect, it} from 'vitest';
import {Vector3} from 'three';
import {HOVER_HEIGHT, PAD, startDrill, updateDrill, type Frame} from './drills';
import {DEFAULT_MAPPING, GameControllerSticks, movedAxis, readAxes} from './input';

const frame = (overrides: Partial<Frame>): Frame => ({
  dt: 0.5,
  position: PAD.clone().setY(HOVER_HEIGHT),
  heading: 0,
  grounded: false,
  crashed: false,
  ...overrides,
});

describe('the hover drill', () => {
  it('counts the time in the box facing the way asked, and starts again on leaving it', () => {
    let drill = startDrill('hover', 'tail');
    drill = updateDrill(drill, frame({}));
    drill = updateDrill(drill, frame({heading: 0.3}));
    expect(drill).toMatchObject({inside: true, streak: 1, best: 1, total: 1});
    drill = updateDrill(drill, frame({position: PAD.clone().setY(3)}));
    expect(drill).toMatchObject({inside: false, streak: 0, best: 1, total: 1});
    drill = updateDrill(drill, frame({heading: Math.PI}));
    expect(drill).toMatchObject({inside: false, streak: 0});
  });

  it('wants the nose towards the pilot for nose-in', () => {
    const drill = updateDrill(startDrill('hover', 'nose'), frame({heading: -Math.PI + 0.1}));
    expect(drill).toMatchObject({inside: true});
  });
});

describe('the landing drill', () => {
  it('grades a landing after a climb, and keeps the softest on the pad', () => {
    let drill = startDrill('landing');
    drill = updateDrill(drill, frame({landed: {speed: 0.1, at: PAD.clone()}}));
    expect(drill).toMatchObject({phase: 'land', count: 0});
    drill = updateDrill(drill, frame({landed: {speed: 0.5, at: PAD.clone()}, grounded: true}));
    expect(drill).toMatchObject({phase: 'climb', count: 1, last: {grade: 'Firm', onPad: true}, best: {speed: 0.5}});
    drill = updateDrill(drill, frame({}));
    drill = updateDrill(drill, frame({landed: {speed: 0.2, at: new Vector3(3, 0, -5)}, grounded: true}));
    expect(drill).toMatchObject({count: 2, last: {grade: 'Soft', onPad: false}, best: {speed: 0.5}});
  });
});

describe('the sticks', () => {
  it('read the radio channels, the throttle off under 5 %', () => {
    const controls = readAxes([0.5, -0.2, -1, 0.1, 0, 0.3, 0, 0], DEFAULT_MAPPING);
    expect(controls).toEqual({roll: 0.5, pitch: -0.2, yaw: 0.1, collective: 0.3, throttle: 0});
    expect(readAxes([0, 0, 0.2, 0, 0, 0], DEFAULT_MAPPING).throttle).toBeCloseTo(0.6);
    expect(readAxes([0, 0, 0, 0, 0, 0.3], {...DEFAULT_MAPPING, collective: {axis: 5, reverse: true}}).collective).toBe(
      -0.3,
    );
  });

  it('find the axis a stick moved, and which way', () => {
    expect(movedAxis([0, 0, 0, 0], [0.1, 0, -0.9, 0.5])).toEqual({axis: 2, reverse: true});
    expect(movedAxis([0, 0, 0, 0], [0.1, 0, -0.9, 0.5], [2])).toEqual({axis: 3, reverse: false});
    expect(movedAxis([0, 0], [0.2, 0.1])).toBeNull();
  });
});

describe('a game controller', () => {
  const pad = (axes: number[], pressed: number[] = []) => ({
    axes,
    buttons: Array.from({length: 16}, (_, index) => ({pressed: pressed.includes(index), touched: false, value: 0})),
  });

  it('flies mode 2, the collective centred on hover pitch', () => {
    const sticks = new GameControllerSticks();
    expect(sticks.read(pad([0, 0, 0, 0]), 0.3)).toMatchObject({collective: 0.3, throttle: 0});
    // Full up and down reach the ends of the pitch; a small push stays near hover pitch.
    expect(sticks.read(pad([0, -1, 0, 0]), 0.3).collective).toBeCloseTo(1);
    expect(sticks.read(pad([0, 1, 0, 0]), 0.3).collective).toBeCloseTo(-1);
    expect(sticks.read(pad([0, -0.3, 0, 0]), 0.3).collective).toBeLessThan(0.36);
    // Upside down the centre is the inverted hover pitch, and the ends still reach both ends of the pitch.
    expect(sticks.read(pad([0, 0, 0, 0]), -0.3).collective).toBe(-0.3);
    expect(sticks.read(pad([0, -1, 0, 0]), -0.3).collective).toBeCloseTo(1);
    expect(sticks.read(pad([0, 1, 0, 0]), -0.3).collective).toBeCloseTo(-1);
    expect(sticks.read(pad([0.5, 0, 1, -1]), 0.3)).toMatchObject({roll: 1, pitch: 1});
    expect(sticks.read(pad([0.05, 0, 0, 0]), 0.3).yaw).toBe(0);
  });

  it('turns the motor on and off with the left trigger and steps the idle ups with LB, once a pull', () => {
    const sticks = new GameControllerSticks();
    const pull = (button: number) => ({
      axes: [0, 0, 0, 0],
      buttons: Array.from({length: 16}, (_, index) => ({
        pressed: index === button,
        touched: false,
        value: index === button ? 1 : 0,
      })),
    });
    expect(sticks.read(pad([0, 0, 0, 0]), 0).throttle).toBe(0);
    // Out of hold but not armed: no motor, until the D-pad's up arrow arms it.
    expect(sticks.read(pull(6), 0).throttle).toBe(0);
    expect(sticks.read(pull(12), 0)).toMatchObject({throttle: 0.6, armed: true});
    expect(sticks.read(pull(12), 0).throttle).toBe(0.6);
    expect(sticks.read(pull(3), 0).throttle).toBe(0.6);
    expect(sticks.read(pull(4), 0).throttle).toBe(0.75);
    expect(sticks.status).toEqual({idleUp: 3, hold: false, armed: true});
    sticks.read(pad([0, 0, 0, 0]), 0);
    expect(sticks.read(pull(6), 0).throttle).toBe(0);
    expect(sticks.read(pull(0), 0).throttle).toBe(0);
    expect(sticks.read(pull(7), 0).rescue).toBe(true);
  });

  it('steps the rates with RB, and turns self-level on and off with Y', () => {
    const sticks = new GameControllerSticks();
    const press = (button: number, axes = [0, 0, 1, 0]) => ({
      axes,
      buttons: Array.from({length: 16}, (_, index) => ({
        pressed: index === button,
        touched: false,
        value: index === button ? 1 : 0,
      })),
    });
    expect(sticks.read(press(3), 0)).toMatchObject({level: true, rates: '100 %', roll: 1});
    expect(sticks.read(press(5), 0)).toMatchObject({level: true, rates: '70 %', roll: 0.7});
    sticks.read(press(-1), 0);
    expect(sticks.read(press(5), 0)).toMatchObject({rates: '100 %', roll: 1});
    sticks.read(press(-1), 0);
    expect(sticks.read(press(3), 0)).toMatchObject({level: false});
    // Raw, for the model's mixer: the rates are left to the model.
    sticks.read(press(-1), 0);
    sticks.read(press(5), 0);
    expect(sticks.read(press(-1), 0, true)).toMatchObject({rates: '70 %', roll: 1});
  });
});
