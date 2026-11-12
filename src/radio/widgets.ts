import type {TelemetrySeries} from '../types';
import {CHANNELS, type Channel} from '../model/telemetry';

/** A radio widget built from edge-tx (TypeScript turned into Lua), as `npm run widgets` copies it into public/. */
export interface WidgetFile {
  file: string;
  /** The name the widget registers on the radio. */
  name: string;
  /** When it was last built: the dev server reports rebuilds, so the page reloads the one on show. */
  changed: number;
}

export async function listWidgets(): Promise<WidgetFile[]> {
  const response = await fetch('/widgets/widgets.json', {cache: 'no-store'});
  if (!response.ok) throw new Error('No widgets found');
  return (await response.json()) as WidgetFile[];
}

export async function widgetCode(file: string) {
  const response = await fetch(`/widgets/${encodeURIComponent(file)}`, {cache: 'no-store'});
  if (!response.ok) throw new Error(`${file} did not load`);
  return response.text();
}

/** The name a widget registers under (`local name = "ArmedModel"` in the built Lua), else its file's. */
export function widgetName(code: string, file: string) {
  return /^local (?:name|NAME) = "([^"]+)"/m.exec(code)?.[1] ?? file.replace(/\.lua$/, '');
}

/** A model's name as the radio shows it: its fonts have no emoji ("M2 EVO 🟠" is "M2 EVO" there). */
export const radioName = (name: string) => name.replace(/[^\x20-\x7e]/g, '').trim() || name;

/** How a pack signal reads in a list. */
export const signalLabel = (signal: PackSignal) =>
  signal === 'running' ? 'rotor turning' : CHANNELS[signal].label.toLowerCase();

/** What a source can follow in a replayed pack: a channel of its log, or whether the rotor turns. */
export type PackSignal = Channel | 'running';

/** Under this the motor only idles: the pack powers the heli, the rotor is not driven (as Debrief counts it). */
const DRIVEN_AMPS = 2;
/** With no current sensor in the log, the throttle stick above this (%) stands for a driven rotor. */
const DRIVEN_THROTTLE = 15;

/**
 * The signals a pack offers: its channels, the rotor turning when it logs the current or the throttle, and the mAh
 * used when it logs the current (older logs have no mAh sensor: the radio's own is the current added up).
 */
export function packSignals(series: TelemetrySeries | null): PackSignal[] {
  if (!series) return [];
  const channels = (Object.keys(series.channels) as Channel[]).filter(channel => series.channels[channel]?.length);
  if (channels.includes('current') && !channels.includes('capacity')) channels.push('capacity');
  return channels.includes('current') || channels.includes('throttle') ? ['running', ...channels] : channels;
}

/** The output channel a source names: "ch(0)" as the model files write it (from 0), or "CH1" (from 1). */
function outputOf(name: string): Channel | null {
  const fromZero = /^ch\((\d+)\)$/i.exec(name);
  const fromOne = /^ch(\d+)$/i.exec(name);
  const number = fromZero ? Number(fromZero[1]) + 1 : fromOne ? Number(fromOne[1]) : 0;
  return number >= 1 && number <= 8 ? (`ch${number}` as Channel) : null;
}

/**
 * The pack signal a source most likely means, from its name: an arming or throttle-cut switch follows the rotor, a
 * sensor its channel. Empty when nothing fits, and the source stays set by hand.
 */
export function guessSignal(name: string, signals: PackSignal[]): PackSignal | '' {
  // A switch, or the 6-position buttons, the log kept: their real positions.
  const logged = /^s([a-h])$/i.exec(name)
    ? (`s${name.slice(1).toLowerCase()}` as Channel)
    : /^6p$/i.test(name)
      ? 'buttons'
      : null;
  if (logged && signals.includes(logged)) return logged;
  const output = outputOf(name);
  if (output) return signals.includes(output) ? output : '';
  const rules: [RegExp, PackSignal][] = [
    [/arm|cut|hold|motor|idle/i, 'running'],
    [/^(vfas|rxbt|volt|batt|cell)/i, 'voltage'],
    [/^curr/i, 'current'],
    [/mah|capa|fuel|consum/i, 'capacity'],
    [/rssi|rss|signal|rqly|^lq/i, 'rssi'],
    [/^thr/i, 'throttle'],
    [/^ail/i, 'aileron'],
    [/^ele/i, 'elevator'],
    [/^rud/i, 'rudder'],
  ];
  return rules.find(([pattern, signal]) => pattern.test(name) && signals.includes(signal))?.[1] ?? '';
}

/** A channel's sample at a moment of the pack: the last one taken by then. */
function sampleAt(series: TelemetrySeries, channel: Channel, second: number) {
  const values =
    channel === 'capacity' && !series.channels.capacity?.length ? usedByCurrent(series) : series.channels[channel];
  if (!values?.length) return null;
  let index = 0;
  while (index < series.time.length - 1 && series.time[index + 1] <= second) index += 1;
  return values[Math.min(index, values.length - 1)];
}

/** The mAh used by each sample of a pack with no mAh sensor: its current added up, as the radio's mAh sensor does. */
const consumed = new WeakMap<TelemetrySeries, number[]>();
function usedByCurrent(series: TelemetrySeries) {
  const known = consumed.get(series);
  if (known) return known;
  const current = series.channels.current ?? [];
  const used = [0];
  for (let index = 1; index < Math.min(series.time.length, current.length); index += 1) {
    const amps = (current[index] + current[index - 1]) / 2;
    used.push(used[index - 1] + (amps * (series.time[index] - series.time[index - 1])) / 3.6);
  }
  const rounded = used.map(Math.round);
  consumed.set(series, rounded);
  return rounded;
}

/**
 * What getValue gives a widget for a pack signal at a moment of the pack: sensors in their own units (volts, amps,
 * mAh, dB), sticks from -1024 to 1024 as on the radio (Flightdown keeps them in %), and the rotor turning as a switch:
 * up (-1024) while it is driven, down (1024) when not.
 */
export function sourceValue(series: TelemetrySeries, channel: PackSignal, second: number) {
  if (channel === 'running') {
    const current = sampleAt(series, 'current', second);
    const throttle = sampleAt(series, 'throttle', second);
    const driven = current !== null ? current >= DRIVEN_AMPS : (throttle ?? 0) >= DRIVEN_THROTTLE;
    return driven ? -1024 : 1024;
  }
  const value = sampleAt(series, channel, second);
  if (value === null) return 0;
  // Switches are logged -1, 0 or 1: the radio reads -1024, 0 or 1024.
  if (/^s[a-h]$/.test(channel)) return Math.round(value) * 1024;
  if (channel === 'throttle') return Math.round((value / 100) * 2048 - 1024);
  if (channel === 'aileron' || channel === 'elevator' || channel === 'rudder') return Math.round(value * 10.24);
  // Outputs are logged in µs, 1500 the centre and 512 µs each way: the radio reads -1024 to 1024.
  if (outputOf(channel)) return Math.round((value - 1500) * 2);
  return value;
}
