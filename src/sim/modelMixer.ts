/**
 * A game controller or the keyboard flown through the model's own mixer, as the TX16S would fly it: their sticks and
 * buttons become the radio's sticks and switches (Ail, Ele, Rud, Thr; SA armed, SF hold, SE the idle up, SC
 * self-level, SG practice rates, SH the rescue, the pack's 6-position button), and the model's inputs, curves, mixes
 * and logical switches (from the edge-tx card) make the outputs the sim flies, CH1 to CH8, as the radio would send
 * them over USB. So the rates, expo, pitch curves, idle ups and holds are the model's, not guesses.
 */
import type {CardModel} from '../radio/card';
import {channelOutput, outputIndex} from '../radio/mixer';
import {ModelTimers, type Read} from '../radio/timers';
import {DEFAULT_MAPPING, type Mapping, type Stick} from './input';
import {buttonValue} from './radioFeed';

const FULL = 1024;
const UP = -FULL;
const MIDDLE = 0;
const DOWN = FULL;

/** The radio as a controller sets it: sticks -1 to 1 (Thr the collective stick), and the switches. */
export interface RadioState {
  ail: number;
  ele: number;
  rud: number;
  thr: number;
  /** Armed (SA down), and throttle hold off (SF up): the motor runs with both. */
  armed: boolean;
  motor: boolean;
  /** 1 to 3, on SE (up, middle, down). */
  idleUp: number;
  level: boolean;
  practice: boolean;
  rescue: boolean;
  /** The 6-position button pressed for the pack (1 to 6). */
  button: number;
}

/** What the model reads of a radio set so: sticks and switches in the radio's units (-1024 to 1024). */
export function radioSource(state: RadioState, name: string): number {
  switch (name) {
    case 'Ail':
      return Math.round(state.ail * FULL);
    case 'Ele':
      return Math.round(state.ele * FULL);
    case 'Rud':
      return Math.round(state.rud * FULL);
    case 'Thr':
      return Math.round(state.thr * FULL);
    // Armed: SA down (the M2 EVO's since 12 Nov 2026, the K110S's from the start).
    case 'SA':
      return state.armed ? DOWN : UP;
    case 'SF':
      return state.motor ? UP : DOWN;
    case 'SE':
      return state.idleUp === 1 ? UP : state.idleUp === 2 ? MIDDLE : DOWN;
    case 'SC':
      return state.level ? DOWN : UP;
    case 'SG':
      return state.practice ? DOWN : UP;
    case 'SH':
      return state.rescue ? DOWN : UP;
    case 'SB':
    case 'SD':
      return UP;
    case '6P':
      return buttonValue(state.button);
    default:
      return 0;
  }
}

/** The joystick map the model's outputs read through: channel n on axis n - 1, reversed where the model reverses it. */
export function modelMapping(model: Pick<CardModel, 'reversed'> | null): Mapping {
  const sticks = Object.keys(DEFAULT_MAPPING) as Stick[];
  return Object.fromEntries(
    sticks.map(stick => [
      stick,
      {...DEFAULT_MAPPING[stick], reverse: !!model?.reversed?.includes(DEFAULT_MAPPING[stick].axis)},
    ]),
  ) as Mapping;
}

export class ModelMixer {
  readonly model: CardModel;
  readonly mapping: Mapping;
  /** The collective stick (-1 to 1) that gives the hover pitch upright and upside down, in idle up 2, through the model. */
  readonly hover: {upright: number; inverted: number};
  private timers: ModelTimers;

  /** `hoverShare`: the hover pitch as a share of the most pitch (0 to 1). */
  constructor(model: CardModel, hoverShare: number) {
    this.model = model;
    this.mapping = modelMapping(model);
    this.timers = new ModelTimers(model, null);
    const solve = (share: number) => {
      const pitch = (thr: number) => {
        const state: RadioState = {
          ail: 0,
          ele: 0,
          rud: 0,
          thr,
          armed: true,
          motor: true,
          idleUp: 2,
          level: false,
          practice: false,
          rescue: false,
          button: 1,
        };
        const value = this.output(state, 5, performance.now() / 1000) / FULL;
        return this.mapping.collective.reverse ? -value : value;
      };
      // The pitch rises with the stick: halve the gap to the share asked for.
      let low = -1;
      let high = 1;
      for (let step = 0; step < 24; step += 1) {
        const middle = (low + high) / 2;
        if (pitch(middle) < share) low = middle;
        else high = middle;
      }
      return (low + high) / 2;
    };
    this.hover = {upright: solve(hoverShare), inverted: solve(-hoverShare)};
  }

  /** One output (from 0) of the radio set so, -1024 to 1024 as the radio sends it, at `clock` (s). */
  private output(state: RadioState, channel: number, clock: number): number {
    const read: Read = name => {
      const output = outputIndex(name);
      if (output !== null) return channelOutput(this.model, output, read, isOn);
      if (name === 'TELEMETRY_STREAMING') return FULL;
      return radioSource(state, name);
    };
    const isOn = (name: string) => (name === 'TELEMETRY_STREAMING' ? true : this.timers.isOn(name));
    this.timers.advance(clock, () => read);
    return channelOutput(this.model, channel, read, isOn);
  }

  /** The first eight outputs of the radio set so, -1 to 1, as it would send them over USB, at `clock` (s). */
  outputs(state: RadioState, clock: number): number[] {
    return Array.from({length: 8}, (_, channel) => this.output(state, channel, clock) / FULL);
  }
}
