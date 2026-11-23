/**
 * A heli model's idle ups as its own mixer makes them (the card's inputs, curves, mixes and logical switches, run as the
 * radio runs them): the throttle (CH3) and the pitch (CH6) across the collective stick in each idle up (SE up, middle,
 * down), on full rates and on practice rates (SG down). Armed, out of hold, no rescue, no self-level.
 */
import type {CardModel} from './card';
import {ModelMixer, type RadioState} from '../sim/modelMixer';

/** The collective stick (-100 to 100 %) the curves are read at. */
export const STICKS = Array.from({length: 41}, (_, index) => -100 + index * 5);
const THROTTLE = 2;
const PITCH = 5;

export interface IdleUpCurves {
  /** 1 to 3, as SE picks it: up, middle, down. */
  idleUp: number;
  /** At each of STICKS: the throttle (0 to 100 %), the pitch (-100 to 100 %), and the pitch on practice rates. */
  throttle: number[];
  pitch: number[];
  practice: number[];
}

export function idleUpCurves(model: CardModel): IdleUpCurves[] {
  const mixer = new ModelMixer(model, 0);
  // The outputs the right way up: the radio gives a reversed channel upside down (the M2 EVO's CH3).
  const upright = (outputs: number[], channel: number) =>
    model.reversed?.includes(channel) ? -outputs[channel] : outputs[channel];
  let clock = performance.now() / 1000 + 10;
  const sweep = (idleUp: number, practice: boolean) => {
    const state = (thr: number): RadioState => ({
      ail: 0,
      ele: 0,
      rud: 0,
      thr,
      armed: true,
      motor: true,
      idleUp,
      level: false,
      practice,
      rescue: false,
      button: 1,
    });
    // The logical switches' delays run out first (some wait a few seconds), then the stick goes bottom to top.
    clock += 5;
    mixer.outputs(state(0), clock);
    return STICKS.map(stick => {
      clock += 0.1;
      const outputs = mixer.outputs(state(stick / 100), clock);
      return {throttle: ((upright(outputs, THROTTLE) + 1) / 2) * 100, pitch: upright(outputs, PITCH) * 100};
    });
  };
  return [1, 2, 3].map(idleUp => {
    const full = sweep(idleUp, false);
    return {
      idleUp,
      throttle: full.map(at => at.throttle),
      pitch: full.map(at => at.pitch),
      practice: sweep(idleUp, true).map(at => at.pitch),
    };
  });
}

/** A curve's value at `stick` (%), between the sticks it was read at. */
export function valueAt(values: number[], stick: number): number {
  const place = (Math.max(-100, Math.min(100, stick)) + 100) / 5;
  const below = Math.floor(place);
  const above = Math.min(values.length - 1, below + 1);
  return values[below] + (values[above] - values[below]) * (place - below);
}

/** The pitch range (degrees at ±100 %) the model's cockpit widget is set to: its PitchRange option, else null. */
export function pitchRange(model: CardModel): number | null {
  // The option's place among each cockpit's options: the M2 EVO's Cockpit has its idle ups first, the K110S's only it.
  const place: Record<string, number> = {Cockpit: 3, K110Cockpit: 0};
  for (const screen of model.screens) {
    for (const zone of screen.zones) {
      const option = zone.widget in place ? zone.options[place[zone.widget]] : undefined;
      if (option && typeof option.value === 'number' && option.value > 0) return option.value;
    }
  }
  return null;
}
