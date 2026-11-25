import type {Battery, Pack, Sortie, TelemetryLog, TelemetrySeries} from '../types';
import {usedMah} from './battery';
import {daysBetween, today} from './format';

/**
 * Log files this close (seconds from the end of one to the start of the next) are one pack: the radio starts a new file
 * when the telemetry drops for a moment, and no pack is swapped that fast.
 */
const SAME_PACK_GAP = 30;
/**
 * Files with the same pack button this close (s) are one pack too: the pilot disarmed and armed again on it (after a
 * crash, picked up and flown on: the K110S on 25 Nov 2026). No pack is charged again that fast.
 */
const SAME_BUTTON_GAP = 600;
/**
 * A file that starts at rest no more than this above where the file before stopped at rest is the same pack, flown on
 * (within SAME_BUTTON_GAP); one starting higher is another pack. A pack rests up a little, never by 4 %: a fresh 3S pack
 * starts at 12.3 to 12.6 V, a flown one stops at 10.9 to 11.7 (the M2 EVO, Nov 2026).
 */
const SAME_PACK_RISE = 1.04;

/** A pack flown, as the radio logged it: one file or more. */
export interface PackLog {
  files: TelemetryLog[];
  /** Seconds from the start of the first file to the end of the last. */
  duration: number;
  start?: string;
  mAh?: number;
  minVoltage?: number;
  maxCurrent?: number;
  heldCurrent?: number;
  avgCurrent?: number;
  minRssi?: number;
  samples: number;
  /** The 6-position button pressed through it: which pack it was. */
  packButton?: number;
}

/**
 * A time as the radio writes it ("2026-11-24T16:09:02", its own clock, no time zone) as seconds on one line, to measure
 * between two such times: read as UTC, so no time zone or change of summer time comes in between.
 */
export const radioSeconds = (time: string) => Date.parse(`${time}Z`) / 1000;

/** Seconds on that line back to a time as the radio writes it. */
export const radioTime = (seconds: number) => new Date(Math.round(seconds) * 1000).toISOString().slice(0, 19);

/** A crash marked this long (s) after a pack's last sample still belongs to it: the log stops as the motor is held. */
export const CRASH_GRACE = 5;

/** The crashes marked on a sortie that fall in this pack, as seconds of its log (whose 0 is the pack's start). */
export function crashesIn(pack: {start?: string; duration: number}, crashTimes: readonly string[] = []): number[] {
  if (!pack.start) return [];
  const start = radioSeconds(pack.start);
  return crashTimes
    .map(time => radioSeconds(time) - start)
    .filter(second => second >= 0 && second <= pack.duration + CRASH_GRACE);
}

/** Seconds of a log's start, to measure the gaps between files. */
const startSeconds = (log: TelemetryLog) => (log.start ? radioSeconds(log.start) : null);

const smallest = (values: (number | undefined)[]) => {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length ? Math.min(...known) : undefined;
};

const largest = (values: (number | undefined)[]) => {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length ? Math.max(...known) : undefined;
};

/**
 * One pack's figures from its files: the lowest and highest of each, the average current weighted by time, and the mAh
 * each file used (a count carried on from the file before starts from there).
 */
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
    mAh: used.length ? used.reduce((sum, file) => sum + (file.mAh ?? 0) - (file.mAhFrom ?? 0), 0) : undefined,
    minVoltage: smallest(files.map(file => file.minVoltage)),
    maxCurrent: largest(files.map(file => file.maxCurrent)),
    heldCurrent: largest(files.map(file => file.heldCurrent)),
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
 * start time stands alone, after the others. Given how many packs were flown (`count`, the sortie's), files closer
 * than that in time join too, the closest first, while the buttons allow: a K110S relaunched on its pack after a crash
 * starts a new file a minute later, as long as a pack swap takes, and it has no button or sensor to tell them apart.
 */
export function groupPacks(logs: TelemetryLog[], count?: number): PackLog[] {
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
    const sameButton = !!previous?.packButton && previous.packButton === log.packButton;
    // The volts tell best, when both ends were read at rest; else the time between, and the button.
    const byVolts =
      previous?.endVoltage && log.startVoltage ? log.startVoltage <= previous.endVoltage * SAME_PACK_RISE : null;
    const samePack =
      byVolts === null
        ? gap <= SAME_PACK_GAP || (sameButton && gap <= SAME_BUTTON_GAP)
        : byVolts && gap <= SAME_BUTTON_GAP;
    if (group && !otherPack && samePack) group.push(log);
    else groups.push([log]);
  }
  while (count && groups.length > count) {
    // The two packs flown closest together, the first's last file and the second's first, of the same button or none.
    let closest: {index: number; gap: number} | null = null;
    for (let index = 1; index < groups.length; index += 1) {
      const previous = groups[index - 1][groups[index - 1].length - 1];
      const next = groups[index][0];
      if (previous.packButton !== undefined && next.packButton !== undefined && previous.packButton !== next.packButton)
        continue;
      const gap = (startSeconds(next) ?? 0) - ((startSeconds(previous) ?? 0) + previous.duration);
      if (!closest || gap < closest.gap) closest = {index, gap};
    }
    if (!closest) break;
    groups.splice(closest.index - 1, 2, [...groups[closest.index - 1], ...groups[closest.index]]);
  }
  for (const log of logs) if (startSeconds(log) === null) groups.push([log]);
  return groups.map(summarise);
}

/** A sortie's packs, as its logs flew them and as many as it says. */
export const sortiePacks = (sortie: Pick<Sortie, 'telemetry' | 'packs'>) => groupPacks(sortie.telemetry, sortie.packs);

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
 * it was), among the packs its heli flies: "OMPHobby #1", the kind's name up to its cells.
 */
export function packName(pack: PackLog, batteries: Battery[], heliId: string): string | null {
  return buttonPack(pack.packButton ?? 0, batteries, pack.start?.slice(0, 10) ?? '', heliId);
}

/**
 * The pack a 6-position button stood for on a day (else today), and its kind: of the packs that had the button by
 * then (and had not moved off it), the one given it last, so a new pack on a dead one's button takes over from the day
 * it got it. Given a heli, only the kinds it flies: the K110S's logs read the button the M2 EVO's packs are on, untouched.
 */
export function buttonBattery(button: number, batteries: Battery[], day = today(), heliId?: string) {
  let found: {battery: Battery; pack: Pack; since: string} | null = null;
  for (const battery of batteries) {
    if (heliId && !battery.heliIds.includes(heliId)) continue;
    for (const pack of battery.packs) {
      const held = [...(pack.earlier ?? []), ...(pack.button ? [{button: pack.button, since: pack.since}] : [])];
      for (const spell of held) {
        if (spell.button !== button || (spell.since && day < spell.since)) continue;
        if ('until' in spell && day >= spell.until) continue;
        if (!found || (spell.since ?? '') > found.since) found = {battery, pack, since: spell.since ?? ''};
      }
    }
  }
  return found && {battery: found.battery, pack: found.pack};
}

/** A kind's name up to its cells: "OMPHobby" of "OMPHobby 3S 750 mAh 60C". Kinds named alike number their packs as one. */
export const kindName = (name: string) => name.split(/\s\d+S\s/)[0].trim();

/** A pack's name: its kind's up to the cells, and its number ("OMPHobby #1"). */
export const packLabel = (battery: Battery, pack: Pack) => `${kindName(battery.name)} #${pack.number}`;

/** The pack a 6-position button stands for ("OMPHobby #1"), on a day, else today, among a heli's kinds if given. */
export function buttonPack(button: number, batteries: Battery[], day?: string, heliId?: string): string | null {
  const found = buttonBattery(button, batteries, day, heliId);
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
    for (const pack of sortiePacks(sortie)) {
      const found = buttonBattery(
        pack.packButton ?? 0,
        batteries,
        pack.start?.slice(0, 10) ?? sortie.date,
        sortie.heliId,
      );
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

/** A pack's record from the logs: how often and when it flew, and its resistance (a cell's share, mΩ). */
export interface PackRecord {
  battery: Battery;
  pack: Pack;
  /** "Gens Ace #3". */
  label: string;
  /** Packs flown on it that a log names by its button. */
  flights: number;
  /** The day it last flew, by the logs (YYYY-MM-DD). */
  last?: string;
  /** Its first resistance reading and its latest: twice the first is worn. */
  first?: number;
  latest?: number;
  /** Every flight's resistance (a cell's share, mΩ), mAh used and lowest cell (V), oldest first. */
  readings: number[];
  mahs: number[];
  lows: number[];
}

/** Every pack's record, from the logs that name it by its button, oldest sortie first. */
export function packRecords(sorties: Sortie[], batteries: Battery[]): PackRecord[] {
  const records = new Map<string, PackRecord>();
  const key = (battery: Battery, pack: Pack) => `${battery.id}#${pack.number}`;
  for (const battery of batteries) {
    for (const pack of battery.packs)
      records.set(key(battery, pack), {
        battery,
        pack,
        label: packLabel(battery, pack),
        flights: 0,
        readings: [],
        mahs: [],
        lows: [],
      });
  }
  for (const sortie of [...sorties].sort((left, right) => left.date.localeCompare(right.date))) {
    for (const flown of sortiePacks(sortie)) {
      const day = flown.start?.slice(0, 10) ?? sortie.date;
      const found = buttonBattery(flown.packButton ?? 0, batteries, day, sortie.heliId);
      const record = found && records.get(key(found.battery, found.pack));
      if (!found || !record) continue;
      record.flights += 1;
      record.last = day;
      if (flown.mAh !== undefined) record.mahs.push(flown.mAh);
      if (flown.minVoltage !== undefined && flown.minVoltage > 0.5) {
        record.lows.push(flown.minVoltage / found.battery.cells);
      }
      const readings = flown.files.flatMap(file =>
        file.resistance === undefined ? [] : [file.resistance / found.battery.cells],
      );
      if (!readings.length) continue;
      const median = readings.sort((left, right) => left - right)[Math.floor(readings.length / 2)];
      record.first ??= median;
      record.latest = median;
      record.readings.push(median);
    }
  }
  return [...records.values()];
}

/**
 * How worn a pack is: its latest resistance against its own first reading and against the freshest pack's, the larger
 * (1.5 is tiring, 2 worn); null with no reading.
 */
export function packWear(record: PackRecord, freshest: number): number | null {
  if (!record.first || !record.latest) return null;
  return Math.max(record.latest / record.first, Number.isFinite(freshest) ? record.latest / freshest : 0);
}

/** A LiPo left charged this long, in days, should go to storage charge (3.8 V a cell). */
export const STORAGE_DAYS = 10;

/**
 * The packs to take next, best first: the live ones not worn, the most rested first (never flown before any), fewer
 * flights first on a tie, tiring ones last, so the packs wear evenly. And those unflown long enough to go to storage
 * charge, longest first.
 */
export function nextPacks(records: PackRecord[], day = today()) {
  const live = records.filter(record => !record.pack.dead);
  const freshest = Math.min(...live.flatMap(record => (record.latest === undefined ? [] : [record.latest])));
  const rested = (record: PackRecord) => (record.last ? daysBetween(record.last, day) : Infinity);
  const next = live
    .map(record => ({record, wear: packWear(record, freshest), rested: rested(record)}))
    .filter(({wear}) => wear === null || wear < 2)
    .sort(
      (left, right) =>
        Number((left.wear ?? 0) >= 1.5) - Number((right.wear ?? 0) >= 1.5) ||
        right.rested - left.rested ||
        left.record.flights - right.record.flights,
    )
    .map(({record}) => record);
  const storage = live
    .filter(record => record.last && rested(record) >= STORAGE_DAYS)
    .map(record => ({record, days: rested(record)}))
    .sort((left, right) => right.days - left.days);
  return {next, storage};
}

/** The mAh a pack used, from its joined samples: the radio's count or the current added up. */
export function packUsed(series: TelemetrySeries) {
  const used = usedMah(series);
  return used?.length ? Math.round(used[used.length - 1]) : undefined;
}
