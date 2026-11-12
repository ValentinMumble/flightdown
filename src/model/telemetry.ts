import type {Sortie, TelemetryLog, TelemetrySeries} from '../types';
import {pad} from './format';
import {newId} from './ids';
import {invertedStretches, packResistance} from './insights';

/** From this current the motor works under load: the heli is in the air (2 A, as the radio's Session widget). */
const FLYING_AMPS = 2;
/** How far (µs) the motor's output strays from cut before it counts as on: past the output's jitter. */
const MOTOR_SLACK = 20;

/** The value a list holds most often. */
function mostFrequent(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((left, right) => right[1] - left[1])[0][0];
}

/** A cell of a log: text from a CSV, or a number from a spreadsheet (days and times are numbers there). */
export type Cell = string | number | null;

/** The sensors kept from a log, and the EdgeTX columns that can hold each (receivers name them differently). */
export const CHANNELS = {
  voltage: {label: 'Pack voltage', unit: 'V', columns: ['VFAS', 'Bat', 'BtRx', 'RxBt']},
  current: {label: 'Current', unit: 'A', columns: ['Curr']},
  capacity: {label: 'Capacity used', unit: 'mAh', columns: ['Capa', 'Fuel', 'mAh']},
  rssi: {label: 'Signal', unit: 'dB', columns: ['RSSI', '1RSS', 'TRSS', 'RQly']},
  throttle: {label: 'Throttle stick', unit: '%', columns: ['Thr']},
  aileron: {label: 'Aileron stick', unit: '%', columns: ['Ail']},
  elevator: {label: 'Elevator stick', unit: '%', columns: ['Ele']},
  rudder: {label: 'Rudder stick', unit: '%', columns: ['Rud']},
  // The switches, -1 (up), 0 (middle) or 1 (down), and the 6-position buttons, -1024 to 1024 in six steps.
  sa: {label: 'Switch SA', unit: '', columns: ['SA']},
  sb: {label: 'Switch SB', unit: '', columns: ['SB']},
  sc: {label: 'Switch SC', unit: '', columns: ['SC']},
  sd: {label: 'Switch SD', unit: '', columns: ['SD']},
  se: {label: 'Switch SE', unit: '', columns: ['SE']},
  sf: {label: 'Switch SF', unit: '', columns: ['SF']},
  sg: {label: 'Switch SG', unit: '', columns: ['SG']},
  sh: {label: 'Switch SH', unit: '', columns: ['SH']},
  // "6P" until EdgeTX 2.12, which logs the TX16S's knobs and buttons as P1, P2 (the buttons) and P3.
  buttons: {label: '6-position buttons', unit: '', columns: ['6P', 'P2']},
  // What the radio sends on its first eight channels, in µs (1500 the centre): the Radio tab's Outputs replays them.
  ch1: {label: 'Output CH1', unit: 'µs', columns: ['CH1']},
  ch2: {label: 'Output CH2', unit: 'µs', columns: ['CH2']},
  ch3: {label: 'Output CH3', unit: 'µs', columns: ['CH3']},
  ch4: {label: 'Output CH4', unit: 'µs', columns: ['CH4']},
  ch5: {label: 'Output CH5', unit: 'µs', columns: ['CH5']},
  ch6: {label: 'Output CH6', unit: 'µs', columns: ['CH6']},
  ch7: {label: 'Output CH7', unit: 'µs', columns: ['CH7']},
  ch8: {label: 'Output CH8', unit: 'µs', columns: ['CH8']},
} as const;

/** An output channel of the log: ch1 to ch8. */
export const isOutput = (channel: string) => /^ch\d$/.test(channel);

/** The 6-position button pressed (1 to 6) from the value logged for them. */
export const buttonOf = (value: number) => Math.max(1, Math.min(6, Math.round((value + 1024) / 409.6) + 1));

export type Channel = keyof typeof CHANNELS;

/**
 * How many points a log keeps per sensor: a 6-minute pack logged 5 times a second fits whole (sharp stick maps), a
 * long log is averaged down, and one log stays near 150 KB.
 */
const MAX_POINTS = 2000;

/** "RxBt(V)" → "RxBt". */
const columnName = (header: Cell) =>
  String(header ?? '')
    .replace(/\(.*$/, '')
    .trim();

function toNumber(value: Cell) {
  if (typeof value === 'number') return value;
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

/** Seconds since midnight from "12:18:54.120", or from a fraction of a day as a workbook keeps times. */
function clockSeconds(value: Cell) {
  if (typeof value === 'number') return value * 86_400;
  const match = /^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(String(value ?? '').trim());
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

/** "2023-04-28", "28/04/2023" or a workbook day number to YYYY-MM-DD. */
export function readDay(value: Cell): string | null {
  if (typeof value === 'number') {
    if (value < 20_000 || value > 80_000) return null;
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }
  const text = String(value ?? '').trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;
  const european = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(text);
  if (european) {
    const year = european[3].length === 2 ? `20${european[3]}` : european[3];
    let day = Number(european[1]);
    let month = Number(european[2]);
    // Day first, as the sheets this was written for; month first only when the day cannot be one.
    if (month > 12 && day <= 12) [day, month] = [month, day];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  return null;
}

/** True for a table whose header looks like an EdgeTX log: Date, Time and some sensors. */
export function isTelemetryHeader(header: Cell[]) {
  const names = header.map(columnName);
  const sensors = Object.values(CHANNELS).flatMap(channel => channel.columns as readonly string[]);
  return names.includes('Date') && names.includes('Time') && names.some(name => sensors.includes(name));
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Thins samples to at most MAX_POINTS, averaging each stretch. */
function thin(time: number[], channels: Record<string, number[]>) {
  if (time.length <= MAX_POINTS) return {time, channels};
  const size = time.length / MAX_POINTS;
  const thinTime: number[] = [];
  const thinChannels: Record<string, number[]> = Object.fromEntries(Object.keys(channels).map(key => [key, []]));
  for (let bucket = 0; bucket < MAX_POINTS; bucket += 1) {
    const from = Math.floor(bucket * size);
    const to = Math.max(from + 1, Math.floor((bucket + 1) * size));
    thinTime.push(Math.round(average(time.slice(from, to)) * 10) / 10);
    for (const [key, values] of Object.entries(channels)) {
      thinChannels[key].push(Math.round(average(values.slice(from, to)) * 100) / 100);
    }
  }
  return {time: thinTime, channels: thinChannels};
}

/**
 * Reads an EdgeTX log (a CSV from the radio's LOGS folder, or the same table pasted in a sheet): the summary kept
 * with the sortie, and the samples kept apart for its charts.
 */
export function readTelemetry(rows: Cell[][], name: string): {log: TelemetryLog; series: TelemetrySeries} | null {
  const headerIndex = rows.findIndex(row => row && isTelemetryHeader(row));
  if (headerIndex < 0) return null;
  const header = rows[headerIndex].map(columnName);
  const dateColumn = header.indexOf('Date');
  const timeColumn = header.indexOf('Time');
  const columns = Object.fromEntries(
    (Object.keys(CHANNELS) as Channel[]).map(channel => [
      channel,
      (CHANNELS[channel].columns as readonly string[]).map(column => header.indexOf(column)).find(index => index >= 0),
    ]),
  ) as Record<Channel, number | undefined>;

  const time: number[] = [];
  const channels: Record<string, number[]> = {};
  let day: string | null = null;
  let firstClock: number | null = null;
  for (const row of rows.slice(headerIndex + 1)) {
    if (!row) continue;
    const clock = clockSeconds(row[timeColumn] ?? null);
    if (clock === null) continue;
    day ??= readDay(row[dateColumn] ?? null);
    firstClock ??= clock;
    // A log that runs past midnight keeps counting up.
    time.push(clock < firstClock ? clock + 86_400 - firstClock : clock - firstClock);
    for (const channel of Object.keys(columns) as Channel[]) {
      const column = columns[channel];
      if (column === undefined) continue;
      let value = toNumber(row[column] ?? null) ?? 0;
      // Sticks run from -1024 to 1024: throttle shown as 0 to 100 %, the others as -100 to 100 % around centre.
      if (channel === 'throttle') value = Math.round(((value + 1024) / 2048) * 100);
      else if (channel === 'aileron' || channel === 'elevator' || channel === 'rudder') {
        value = Math.round((value / 1024) * 100);
      }
      (channels[channel] ??= []).push(value);
    }
  }
  if (time.length < 2 || firstClock === null) return null;

  const duration = time[time.length - 1];
  const voltages = (channels.voltage ?? []).filter(value => value > 0.5);
  const currents = channels.current ?? [];
  const signals = (channels.rssi ?? []).filter(value => value > 0);
  let mAh: number | undefined;
  if (channels.capacity?.some(value => value > 0)) mAh = Math.max(...channels.capacity);
  else if (currents.length) {
    let used = 0;
    for (let index = 1; index < time.length; index += 1) {
      used += ((currents[index] + currents[index - 1]) / 2) * ((time[index] - time[index - 1]) / 3600) * 1000;
    }
    mAh = Math.round(used);
  }
  if (!channels.capacity?.some(value => value > 0)) delete channels.capacity;
  // In the air: the motor on, its output (CH3) away from where it sits cut (its value while the pack draws nothing),
  // as the radio's PACK timer counts it; a log with no outputs counts the motor under load, as the Session widget does.
  const motor = channels.ch3;
  let flying = 0;
  if (motor?.length) {
    const idle = currents.length ? motor.filter((_, index) => (currents[index] ?? 0) < 0.5) : [];
    const cut = mostFrequent(idle.length ? idle : [motor[0]]);
    for (let index = 1; index < motor.length; index += 1) {
      if (Math.abs(motor[index] - cut) > MOTOR_SLACK) flying += time[index] - time[index - 1];
    }
  } else {
    for (let index = 1; index < currents.length; index += 1) {
      if (currents[index] >= FLYING_AMPS) flying += time[index] - time[index - 1];
    }
  }

  // Upside down, read from every sample before they are thinned.
  const upsideDown = invertedStretches({id: '', time, channels}).reduce((sum, stretch) => sum + stretch.seconds, 0);

  const id = newId();
  const clock = Math.floor(firstClock);
  const start = day
    ? `${day}T${pad(Math.floor(clock / 3600))}:${pad(Math.floor((clock % 3600) / 60))}:${pad(clock % 60)}`
    : undefined;
  const round = (value: number) => Math.round(value * 100) / 100;
  // The pack: the 6-position button pressed through most of the log.
  const pressed = (channels.buttons ?? []).map(buttonOf);
  const counts = pressed.reduce<Record<number, number>>(
    (tally, button) => ({...tally, [button]: (tally[button] ?? 0) + 1}),
    {},
  );
  const packButton = pressed.length
    ? Number(Object.entries(counts).sort((left, right) => right[1] - left[1])[0][0])
    : undefined;
  // The samples as kept, and the pack's resistance from them, as its card reads it.
  const series = {id, ...thin(time, channels)};
  const resistance = packResistance(series);
  const log: TelemetryLog = {
    id,
    name,
    start,
    duration: Math.round(duration),
    samples: time.length,
    ...(mAh !== undefined && {mAh}),
    ...(voltages.length && {minVoltage: round(Math.min(...voltages))}),
    ...(currents.length && {maxCurrent: round(Math.max(...currents)), avgCurrent: round(average(currents))}),
    ...(signals.length && {minRssi: Math.min(...signals)}),
    ...(packButton !== undefined && {packButton}),
    ...((motor?.length || currents.length) && {flying: Math.round(flying)}),
    ...(channels.ch6?.length && currents.length && {inverted: Math.round(upsideDown)}),
    ...(resistance !== null && {resistance: Math.round(resistance)}),
  };
  return {log, series};
}

/** "M2 EVO-2023-04-28-121854.csv" → "M2 EVO", the model's name on the radio. */
export function modelFromFileName(fileName: string) {
  return /^(.*)-\d{4}-\d{2}-\d{2}-\d{6}\.csv$/i.exec(fileName)?.[1]?.trim() ?? null;
}

export const simple = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();

/**
 * The sortie a log belongs to: one on the log's day, on the heli whose name starts with the radio model's name; the
 * longest that day when the log does not name its model. None when the named model did not fly that day.
 */
export function matchSortie(
  log: TelemetryLog,
  model: string | null,
  sorties: Sortie[],
  heliName: (id: string) => string,
) {
  const day = log.start?.slice(0, 10);
  if (!day) return null;
  const sameDay = sorties.filter(sortie => sortie.date === day);
  if (!sameDay.length) return null;
  const wanted = model ? simple(model) : '';
  const candidates = wanted ? sameDay.filter(sortie => simple(heliName(sortie.heliId)).startsWith(wanted)) : sameDay;
  if (!candidates.length) return null;
  return candidates.reduce((best, sortie) =>
    sortie.packs * (sortie.timer ?? 0) > best.packs * (best.timer ?? 0) ? sortie : best,
  );
}

/** A channel's value at a moment between two samples, drawn in a straight line between them; null with no samples. */
export function sampleAt(time: number[], values: number[] | undefined, second: number): number | null {
  if (!values?.length || !time.length) return null;
  const last = Math.min(time.length, values.length) - 1;
  if (second <= time[0]) return values[0];
  if (second >= time[last]) return values[last];
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (time[middle] <= second) low = middle;
    else high = middle;
  }
  const span = time[high] - time[low] || 1;
  return values[low] + ((values[high] - values[low]) * (second - time[low])) / span;
}
