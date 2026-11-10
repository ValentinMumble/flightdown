import type {Session, TelemetryLog, TelemetrySeries} from '../types';
import {pad} from './format';
import {newId} from './ids';

/** A cell of a log: text from a CSV, or a number from a spreadsheet (days and times are numbers there). */
export type Cell = string | number | null;

/** The sensors kept from a log, and the EdgeTX columns that can hold each (receivers name them differently). */
export const CHANNELS = {
  voltage: {label: 'Pack voltage', unit: 'V', columns: ['VFAS', 'Bat', 'BtRx', 'RxBt']},
  current: {label: 'Current', unit: 'A', columns: ['Curr']},
  capacity: {label: 'Capacity used', unit: 'mAh', columns: ['Capa', 'Fuel']},
  rssi: {label: 'Signal', unit: 'dB', columns: ['RSSI', '1RSS', 'TRSS', 'RQly']},
  throttle: {label: 'Throttle stick', unit: '%', columns: ['Thr']},
  aileron: {label: 'Aileron stick', unit: '%', columns: ['Ail']},
  elevator: {label: 'Elevator stick', unit: '%', columns: ['Ele']},
  rudder: {label: 'Rudder stick', unit: '%', columns: ['Rud']},
} as const;

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
 * with the session, and the samples kept apart for its charts.
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

  const id = newId();
  const clock = Math.floor(firstClock);
  const start = day
    ? `${day}T${pad(Math.floor(clock / 3600))}:${pad(Math.floor((clock % 3600) / 60))}:${pad(clock % 60)}`
    : undefined;
  const round = (value: number) => Math.round(value * 100) / 100;
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
  };
  return {log, series: {id, ...thin(time, channels)}};
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
 * The session a log belongs to: one on the log's day, on the heli whose name starts with the radio model's name; the
 * longest that day when the log does not name its model. None when the named model did not fly that day.
 */
export function matchSession(
  log: TelemetryLog,
  model: string | null,
  sessions: Session[],
  heliName: (id: string) => string,
) {
  const day = log.start?.slice(0, 10);
  if (!day) return null;
  const sameDay = sessions.filter(session => session.date === day);
  if (!sameDay.length) return null;
  const wanted = model ? simple(model) : '';
  const candidates = wanted ? sameDay.filter(session => simple(heliName(session.heliId)).startsWith(wanted)) : sameDay;
  if (!candidates.length) return null;
  return candidates.reduce((best, session) =>
    session.packs * (session.timer ?? 0) > best.packs * (best.timer ?? 0) ? session : best,
  );
}
