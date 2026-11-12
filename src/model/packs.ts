import type {Battery, Pack, Sortie, TelemetryLog, TelemetrySeries} from '../types';
import {usedMah} from './battery';
import {today} from './format';

/**
 * Log files this close (seconds from the end of one to the start of the next) are one pack: the radio starts a new file
 * when the telemetry drops for a moment, and no pack is swapped that fast.
 */
const SAME_PACK_GAP = 30;

/** A pack flown, as the radio logged it: one file or more. */
export interface PackLog {
  files: TelemetryLog[];
  /** Seconds from the start of the first file to the end of the last. */
  duration: number;
  start?: string;
  mAh?: number;
  minVoltage?: number;
  maxCurrent?: number;
  avgCurrent?: number;
  minRssi?: number;
  samples: number;
  /** The 6-position button pressed through it: which pack it was. */
  packButton?: number;
}

/** Seconds of a log's start ("2023-04-28T12:43:01"), to measure the gaps between files. */
const startSeconds = (log: TelemetryLog) => (log.start ? Date.parse(`${log.start}Z`) / 1000 : null);

const smallest = (values: (number | undefined)[]) => {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length ? Math.min(...known) : undefined;
};

const largest = (values: (number | undefined)[]) => {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length ? Math.max(...known) : undefined;
};

/** One pack's figures from its files: the lowest and highest of each, the average current weighted by time. */
function summarise(files: TelemetryLog[]): PackLog {
  const first = startSeconds(files[0]);
  const last = startSeconds(files[files.length - 1]);
  const duration =
    first !== null && last !== null
      ? Math.round(last - first + files[files.length - 1].duration)
      : files.reduce((sum, file) => sum + file.duration, 0);
  const timed = files.filter(file => file.avgCurrent !== undefined);
  const time = timed.reduce((sum, file) => sum + file.duration, 0);
  const used = files.filter(file => file.mAh !== undefined);
  return {
    files,
    duration,
    start: files[0].start,
    packButton: files[0].packButton,
    mAh: used.length ? used.reduce((sum, file) => sum + (file.mAh ?? 0), 0) : undefined,
    minVoltage: smallest(files.map(file => file.minVoltage)),
    maxCurrent: largest(files.map(file => file.maxCurrent)),
    avgCurrent: time
      ? Math.round((timed.reduce((sum, file) => sum + (file.avgCurrent ?? 0) * file.duration, 0) / time) * 100) / 100
      : undefined,
    minRssi: smallest(files.map(file => file.minRssi)),
    samples: files.reduce((sum, file) => sum + file.samples, 0),
  };
}

/**
 * A sortie's log files as the packs flown, in the order flown: files that follow each other within SAME_PACK_GAP
 * seconds are one pack, unless their 6-position buttons say two packs (a pack swapped that quickly). A file with no
 * start time stands alone, after the others.
 */
export function groupPacks(logs: TelemetryLog[]): PackLog[] {
  const timed = logs
    .filter(log => startSeconds(log) !== null)
    .sort((left, right) => (startSeconds(left) ?? 0) - (startSeconds(right) ?? 0));
  const groups: TelemetryLog[][] = [];
  for (const log of timed) {
    const group = groups[groups.length - 1];
    const previous = group?.[group.length - 1];
    const gap = previous ? (startSeconds(log) ?? 0) - ((startSeconds(previous) ?? 0) + previous.duration) : Infinity;
    const otherPack =
      previous?.packButton !== undefined && log.packButton !== undefined && previous.packButton !== log.packButton;
    if (group && gap <= SAME_PACK_GAP && !otherPack) group.push(log);
    else groups.push([log]);
  }
  for (const log of logs) if (startSeconds(log) === null) groups.push([log]);
  return groups.map(summarise);
}

/**
 * A pack's samples as one log: each file's times moved to when it started within the pack, and the sensors every file
 * has. The radio's mAh count starts again with a new file, so a count that drops carries on from where it stopped.
 */
export function joinSeries(pack: PackLog, parts: TelemetrySeries[]): TelemetrySeries {
  if (parts.length === 1) return parts[0];
  const first = startSeconds(pack.files[0]);
  const keys = Object.keys(parts[0].channels).filter(key => parts.every(part => part.channels[key]?.length));
  const time: number[] = [];
  const channels: Record<string, number[]> = Object.fromEntries(keys.map(key => [key, []]));
  parts.forEach((part, index) => {
    const start = startSeconds(pack.files[index]);
    const shift = first !== null && start !== null ? start - first : (time[time.length - 1] ?? -1) + 1;
    time.push(...part.time.map(second => Math.round((second + shift) * 100) / 100));
    for (const key of keys) {
      const values = part.channels[key];
      const before = channels[key][channels[key].length - 1];
      const restarted = key === 'capacity' && before !== undefined && values[0] < before - 5;
      channels[key].push(...(restarted ? values.map(value => value + before) : values));
    }
  });
  return {id: parts.map(part => part.id).join('+'), time, channels};
}

/**
 * The pack a flight was flown on, from the 6-position button pressed (once its kind was given buttons, and from the day
 * it was): "OMPHobby #1", the kind's name up to its cells.
 */
export function packName(pack: PackLog, batteries: Battery[]): string | null {
  return buttonPack(pack.packButton ?? 0, batteries, pack.start?.slice(0, 10) ?? '');
}

/**
 * The pack a 6-position button stood for on a day (else today), and its kind: of the packs that had the button by
 * then, the one given it last, so a new pack on a dead one's button takes over from the day it got it.
 */
export function buttonBattery(button: number, batteries: Battery[], day = today()) {
  let found: {battery: Battery; pack: Pack} | null = null;
  for (const battery of batteries) {
    for (const pack of battery.packs) {
      if (pack.button !== button || (pack.since && day < pack.since)) continue;
      if (!found || (pack.since ?? '') > (found.pack.since ?? '')) found = {battery, pack};
    }
  }
  return found;
}

/** A kind's name up to its cells: "OMPHobby" of "OMPHobby 3S 750 mAh 60C". Kinds named alike number their packs as one. */
export const kindName = (name: string) => name.split(/\s\d+S\s/)[0].trim();

/** A pack's name: its kind's up to the cells, and its number ("OMPHobby #1"). */
export const packLabel = (battery: Battery, pack: Pack) => `${kindName(battery.name)} #${pack.number}`;

/** The pack a 6-position button stands for ("OMPHobby #1"), on a day, else today. */
export function buttonPack(button: number, batteries: Battery[], day?: string): string | null {
  const found = buttonBattery(button, batteries, day);
  return found ? packLabel(found.battery, found.pack) : null;
}

/** A kind's packs still holding a charge. */
export const livePacks = (battery: Battery) => battery.packs.filter(pack => !pack.dead);

/**
 * Packs flown of each kind (by id): a logged pack goes to the kind its button names; a sortie's other packs (no log,
 * or a log from before the buttons) are shared out among the kinds its heli had by then, by how many packs each has.
 */
export function kindFlights(sorties: Sortie[], batteries: Battery[]) {
  const flights = new Map<string, number>();
  const add = (id: string, count: number) => flights.set(id, (flights.get(id) ?? 0) + count);
  for (const sortie of sorties) {
    let named = 0;
    for (const pack of groupPacks(sortie.telemetry)) {
      const found = buttonBattery(pack.packButton ?? 0, batteries, pack.start?.slice(0, 10) ?? sortie.date);
      if (!found) continue;
      add(found.battery.id, 1);
      named++;
    }
    const rest = Math.max(0, sortie.packs - named);
    const owned = batteries.filter(
      battery => battery.heliIds.includes(sortie.heliId) && (!battery.bought || sortie.date >= battery.bought),
    );
    const sharing = owned.reduce((sum, battery) => sum + battery.packs.length, 0);
    if (rest && sharing) for (const battery of owned) add(battery.id, (rest * battery.packs.length) / sharing);
  }
  return flights;
}

/** The mAh a pack used, from its joined samples: the radio's count or the current added up. */
export function packUsed(series: TelemetrySeries) {
  const used = usedMah(series);
  return used?.length ? Math.round(used[used.length - 1]) : undefined;
}
