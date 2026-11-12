/**
 * A model's mixer, enough of EdgeTX's for the Radio tab to move its outputs as the radio would, from the switches and
 * sticks set by hand: each input takes its first line whose switch is on (source, curve, weight); each channel runs
 * its mix lines in order, each on its switch, adding to (+), replacing (=) or multiplying what is there; a reversed
 * channel comes out upside down, as the radio gives it. Values run from -1024 to 1024, as on the radio.
 */
import type {CardCurve, CardInput, CardMix, CurveRef} from './card';
import type {Read} from './timers';

const FULL = 1024;
/** The TX16S's knobs, sliders and buttons as the model file names them (2.12 and 2.8), and as a source reads. */
const NAMES: Record<string, string> = {P1: 'S1', P2: '6P', P3: 'S2', SL1: 'LS', SL2: 'RS', '6POS': '6P'};

export interface MixedModel {
  inputs?: CardInput[];
  mixes?: CardMix[];
  curves?: CardCurve[];
  reversed?: number[];
}

/** The output (from 0) a source names: "ch(2)" as the model files and widgets write it (from 0), or "CH3" (from 1). */
export function outputIndex(name: string): number | null {
  const fromZero = /^ch\((\d+)\)$/i.exec(name);
  if (fromZero) return Number(fromZero[1]);
  const fromOne = /^CH(\d+)$/i.exec(name);
  return fromOne ? Number(fromOne[1]) - 1 : null;
}

/** A curve's value at `value`: its points joined by straight lines (a smooth curve drawn straight). */
function custom(curve: CardCurve, value: number): number {
  const count = curve.y.length;
  if (count < 2) return value;
  const xs = curve.x ? [-100, ...curve.x, 100] : curve.y.map((_, index) => -100 + (200 * index) / (count - 1));
  const at = (value / FULL) * 100;
  for (let index = 1; index < count; index += 1) {
    if (at <= xs[index] || index === count - 1) {
      const span = xs[index] - xs[index - 1];
      const share = span === 0 ? 1 : Math.min(1, Math.max(0, (at - xs[index - 1]) / span));
      return ((curve.y[index - 1] + share * (curve.y[index] - curve.y[index - 1])) * FULL) / 100;
    }
  }
  return value;
}

function applyCurve(value: number, curve: CurveRef | undefined, curves: CardCurve[]): number {
  if (!curve) return value;
  // A custom curve by its number from 1; an expo by its %. Differential and functions pass the value through.
  if (curve.type === 3) {
    const found = curves[Math.abs(curve.value) - 1];
    return found ? custom(found, curve.value < 0 ? -value : value) : value;
  }
  if (curve.type === 1) {
    const share = curve.value / 100;
    return value * (1 - share + share * (value / FULL) ** 2);
  }
  return value;
}

/** A channel's output (from 0), as the radio's mixer makes it from `read` (sources) and `isOn` (switches). */
export function channelOutput(model: MixedModel, channel: number, read: Read, isOn: (name: string) => boolean): number {
  const curves = model.curves ?? [];
  const on = (name: string) => !name || name === 'NONE' || isOn(name);
  const inputs = new Map<number, number>();
  const input = (index: number): number => {
    const known = inputs.get(index);
    if (known !== undefined) return known;
    const line = (model.inputs ?? []).find(one => one.input === index && on(one.swtch));
    const value = line ? (applyCurve(source(line.source), line.curve, curves) * line.weight) / 100 : 0;
    inputs.set(index, value);
    return value;
  };
  const source = (raw: string): number => {
    const fromInput = /^I(\d+)$/.exec(raw);
    if (fromInput) return input(Number(fromInput[1]));
    const logical = /^ls\((\d+)\)$/.exec(raw);
    if (logical) return isOn(`L${logical[1]}`) ? FULL : -FULL;
    if (raw === 'MAX') return FULL;
    return read(NAMES[raw] ?? raw);
  };
  let value = 0;
  for (const mix of model.mixes ?? []) {
    if (mix.channel !== channel || !on(mix.swtch)) continue;
    const line = (applyCurve(source(mix.source), mix.curve, curves) * mix.weight) / 100 + (mix.offset * FULL) / 100;
    if (mix.how === 'REPL') value = line;
    else if (mix.how === 'MULT') value = (value * line) / FULL;
    else value += line;
  }
  value = Math.max(-FULL, Math.min(FULL, Math.round(value)));
  return model.reversed?.includes(channel) ? -value : value;
}
