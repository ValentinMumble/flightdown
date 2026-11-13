/**
 * What a real helicopter's cockpit and its maintenance records would say of a flight, worked out from the radio's log
 * and the sortie log: exceedance events (as flight data monitoring flags them), the caution panel's lights, the power
 * still available (a power margin), each pack's health (as health and usage monitoring tracks a part), each part's
 * time since it last broke (as a logbook's time since overhaul) and the power curve (amps against collective).
 */
import type {Battery, Sortie, TelemetrySeries} from '../types';
import {motorRunning} from './telemetry';
import {hoverSide, invertedStretches} from './insights';
import {startCharge, usedMah} from './battery';
import {partKey} from './parts';
import {airtime} from './stats';
import {buttonBattery, groupPacks, packLabel, type PackRecord} from './packs';

/** A cell under load below this is past its limit. */
export const CELL_FLOOR = 3.3;
/** The current a pack can give for long, in amps an amp hour: a 700 mAh pack, 21 A (packs' "60C" is a burst rating). */
const PACK_C = 30;
/** EdgeTX's own low signal warning (dB), and a little above it for a caution. */
const LINK_LOW = 45;
const LINK_CAUTION = 50;
/** The share of a pack used past which it is drained deep, and a caution before. */
const DEEP = 0.85;
const DEEP_CAUTION = 0.8;
/** A pack plugged in under this charge (%) was not full. */
const NOT_FULL = 95;
/** An exceedance shorter than this is a blip, not an event; two of a kind closer than MERGE_SECONDS are one. */
const EVENT_SECONDS = 0.4;
const MERGE_SECONDS = 5;
/** Above this, the motor is under load. */
const LOADED_AMPS = 2;

export type ExceedanceKind = 'current' | 'cell' | 'link' | 'deep' | 'strike';

/** A moment the flight went past a limit: when, how long, the worst value, in words. */
export interface Exceedance {
  kind: ExceedanceKind;
  start: number;
  end: number;
  /** The worst value: amps, volts a cell, dB, % used. */
  worst: number;
  text: string;
  /** How many times it went past, when close ones were merged into this one. */
  times: number;
}

/** The current a pack can give for long, in amps: its size times PACK_C. */
export const currentLimit = (capacity: number | undefined) => (capacity ? (capacity / 1000) * PACK_C : undefined);

/** The runs of samples where a test holds, at least EVENT_SECONDS long, as index ranges (last included). */
function runs(time: number[], holds: (index: number) => boolean): [number, number][] {
  const found: [number, number][] = [];
  let from = -1;
  for (let index = 0; index <= time.length; index += 1) {
    const on = index < time.length && holds(index);
    if (on && from < 0) from = index;
    if (!on && from >= 0) {
      if (time[index - 1] - time[from] >= EVENT_SECONDS) found.push([from, index - 1]);
      from = -1;
    }
  }
  return found;
}

/**
 * The flight's exceedances, in time order: the current past what the pack gives for long, a cell under 3.3 V under
 * load, the signal under EdgeTX's warning while flying, the pack drained past 85 %, and a hard stop (the current
 * jumping, then the motor stopping within a second: a strike, likely a crash).
 */
export function exceedances(series: TelemetrySeries, pack: {cells?: number; capacity?: number} = {}): Exceedance[] {
  const {time, channels} = series;
  const current = channels.current ?? [];
  const voltage = channels.voltage ?? [];
  const rssi = channels.rssi ?? [];
  const running = motorRunning(channels);
  const events: Exceedance[] = [];
  const worstOf = ([from, to]: [number, number], values: number[], lowest: boolean) => {
    const span = values.slice(from, to + 1);
    return lowest ? Math.min(...span) : Math.max(...span);
  };

  const limit = currentLimit(pack.capacity);
  if (limit && current.length) {
    for (const run of runs(time, index => current[index] > limit)) {
      const worst = worstOf(run, current, false);
      events.push({
        kind: 'current',
        start: time[run[0]],
        end: time[run[1]],
        worst,
        times: 1,
        text: `${worst.toFixed(1)} A, over the pack's ${Math.round(limit)} A`,
      });
    }
  }
  if (pack.cells && voltage.length) {
    const cells = pack.cells;
    const cell = (index: number) => voltage[index] / cells;
    for (const run of runs(
      time,
      index => current[index] >= LOADED_AMPS && voltage[index] > 0.5 && cell(index) < CELL_FLOOR,
    )) {
      const worst = Math.min(...[...Array(run[1] - run[0] + 1).keys()].map(step => cell(run[0] + step)));
      events.push({
        kind: 'cell',
        start: time[run[0]],
        end: time[run[1]],
        worst,
        times: 1,
        text: `${worst.toFixed(2)} V a cell under load`,
      });
    }
  }
  if (rssi.length) {
    for (const run of runs(time, index => running[index] && rssi[index] > 0 && rssi[index] < LINK_LOW)) {
      const worst = worstOf(run, rssi, true);
      events.push({
        kind: 'link',
        start: time[run[0]],
        end: time[run[1]],
        worst,
        times: 1,
        text: `signal down to ${Math.round(worst)} dB`,
      });
    }
  }
  const used = usedMah(series);
  if (used && pack.capacity) {
    const crossed = used.findIndex(value => value > pack.capacity! * DEEP);
    if (crossed >= 0) {
      const worst = (used[used.length - 1] / pack.capacity) * 100;
      events.push({
        kind: 'deep',
        start: time[crossed],
        end: time[crossed],
        worst,
        times: 1,
        text: `past ${DEEP * 100} % of the pack, ${Math.round(worst)} % by the end`,
      });
    }
  }
  // A strike: the current jumps (more than 10 A from one sample to the next) and the motor stops within a second.
  for (let index = 1; index < current.length; index += 1) {
    if (current[index] - current[index - 1] <= 10) continue;
    const stop = time.findIndex((second, at) => at > index && second - time[index] <= 1 && current[at] < 1);
    if (stop < 0) continue;
    events.push({
      kind: 'strike',
      start: time[index],
      end: time[stop],
      worst: current[index],
      times: 1,
      text: `${current[index].toFixed(1)} A, then the motor stopped: a strike?`,
    });
    index = stop;
  }
  return merge(events.sort((left, right) => left.start - right.start));
}

/** Events of a kind less than MERGE_SECONDS apart as one: a punch-out dipping a cell three times is one event. */
function merge(events: Exceedance[]): Exceedance[] {
  const merged: Exceedance[] = [];
  const lastOf = new Map<ExceedanceKind, Exceedance>();
  for (const event of events) {
    const before = lastOf.get(event.kind);
    if (before && event.start - before.end < MERGE_SECONDS) {
      const lower = event.kind === 'cell' || event.kind === 'link';
      before.end = Math.max(before.end, event.end);
      before.times += 1;
      if (lower ? event.worst < before.worst : event.worst > before.worst) {
        before.worst = event.worst;
        before.text = event.text;
      }
      continue;
    }
    lastOf.set(event.kind, event);
    merged.push(event);
  }
  return merged;
}

export type CautionLevel = 'off' | 'advisory' | 'caution' | 'warning';

/** A light of the caution panel: its label, how lit, and why. */
export interface Caution {
  key: string;
  label: string;
  level: CautionLevel;
  why: string;
}

/**
 * A pack's log as a caution and warning panel: each light off, or lit for an advisory (green: worth knowing), a
 * caution (amber) or a warning (red), each with why. `wear` is the pack's resistance against its first reading or
 * the freshest pack's (see the Cockpit's packs), when known.
 */
export function cautions(
  series: TelemetrySeries,
  pack: {cells?: number; capacity?: number} = {},
  wear?: number,
): Caution[] {
  const {channels} = series;
  const current = channels.current ?? [];
  const voltage = channels.voltage ?? [];
  const rssi = (channels.rssi ?? []).filter(value => value > 0);
  const events = exceedances(series, pack);
  const has = (kind: ExceedanceKind) => events.filter(event => event.kind === kind);
  const light = (key: string, label: string, level: CautionLevel, why: string): Caution => ({key, label, level, why});

  const lowCells =
    pack.cells && voltage.length
      ? Math.min(
          ...voltage
            .map((volts, index) => (current[index] >= LOADED_AMPS && volts > 0.5 ? volts / pack.cells! : Infinity))
            .filter(Number.isFinite),
        )
      : Infinity;
  const lowVolt =
    has('cell').length > 0
      ? light('volt', 'LOW VOLT', 'warning', `${lowCells.toFixed(2)} V a cell under load, under ${CELL_FLOOR} V`)
      : lowCells < 3.5
        ? light('volt', 'LOW VOLT', 'caution', `${lowCells.toFixed(2)} V a cell under load`)
        : light(
            'volt',
            'LOW VOLT',
            'off',
            Number.isFinite(lowCells) ? `${lowCells.toFixed(2)} V a cell at worst` : 'no voltage',
          );

  const limit = currentLimit(pack.capacity);
  const peak = current.length ? Math.max(...current) : 0;
  const highAmp = !limit
    ? light('amp', 'HIGH AMP', 'off', 'pack size unknown')
    : has('current').length > 0
      ? light('amp', 'HIGH AMP', 'warning', `${peak.toFixed(1)} A, over the pack's ${Math.round(limit)} A`)
      : peak > limit * 0.8
        ? light('amp', 'HIGH AMP', 'caution', `${peak.toFixed(1)} A, near the pack's ${Math.round(limit)} A`)
        : light('amp', 'HIGH AMP', 'off', `${peak.toFixed(1)} A at peak`);

  const used = usedMah(series);
  const share = used && pack.capacity ? used[used.length - 1] / pack.capacity : null;
  const deep =
    share === null
      ? light('deep', 'DEEP', 'off', 'pack size unknown')
      : share > DEEP
        ? light('deep', 'DEEP', 'warning', `${Math.round(share * 100)} % of the pack used`)
        : share > DEEP_CAUTION
          ? light('deep', 'DEEP', 'caution', `${Math.round(share * 100)} % of the pack used`)
          : light('deep', 'DEEP', 'off', `${Math.round(share * 100)} % used`);

  const weakest = rssi.length ? Math.min(...rssi) : null;
  const link =
    weakest === null
      ? light('link', 'LINK', 'off', 'no signal logged')
      : has('link').length > 0
        ? light('link', 'LINK', 'warning', `down to ${Math.round(weakest)} dB in flight`)
        : weakest < LINK_CAUTION
          ? light('link', 'LINK', 'caution', `down to ${Math.round(weakest)} dB`)
          : light('link', 'LINK', 'off', `${Math.round(weakest)} dB at worst`);

  const charge = startCharge(series, pack.cells);
  const notFull =
    charge < NOT_FULL
      ? light('full', 'NOT FULL', 'caution', `plugged in at about ${Math.round(charge)} %`)
      : light('full', 'NOT FULL', 'off', 'plugged in full');

  const worn =
    wear === undefined
      ? light('pack', 'PACK WORN', 'off', 'no reading to compare')
      : wear >= 2
        ? light('pack', 'PACK WORN', 'warning', `resistance ${wear.toFixed(1)}× its first or the freshest pack's`)
        : wear >= 1.5
          ? light('pack', 'PACK WORN', 'caution', `resistance ${wear.toFixed(1)}×: tiring`)
          : light('pack', 'PACK WORN', 'off', `resistance ${wear.toFixed(1)}×`);

  const strikes = has('strike');
  const strike = strikes.length
    ? light('strike', 'STRIKE', 'warning', strikes[0].text)
    : light('strike', 'STRIKE', 'off', 'no hard stop');

  // The rescue (SH) is held down only while pressed: its rare position is the held one.
  const rescue = channels.sh ?? [];
  const held = rescue.length ? rescueHeld(rescue) : 0;
  const rescued = held
    ? light('rescue', 'RESCUE', 'caution', `held ${held} ${held === 1 ? 'time' : 'times'}`)
    : light('rescue', 'RESCUE', 'off', 'not used');

  const inverted = invertedStretches(series);
  const upsideDown = inverted.length
    ? light(
        'inverted',
        'INVERTED',
        'advisory',
        `${Math.round(inverted.reduce((sum, one) => sum + one.seconds, 0))} s upside down`,
      )
    : light('inverted', 'INVERTED', 'off', 'never held upside down');

  return [lowVolt, highAmp, deep, link, notFull, worn, strike, rescued, upsideDown];
}

/** How many times a momentary switch was held: runs of its rarer position. */
function rescueHeld(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  if (counts.size < 2) return 0;
  const usual = [...counts].sort((left, right) => right[1] - left[1])[0][0];
  let held = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== usual && (index === 0 || values[index - 1] === usual)) held += 1;
  }
  return held;
}

/**
 * The power the pack could still give at a moment (W), before a cell drops to 3.3 V: from its resistance (the whole
 * pack, Ω) and what it reads now, its voltage at rest is V + I R, and the most current it can give is what brings it
 * down to the floor. Null when it cannot be worked out.
 */
export function availablePower(volts: number, amps: number, ohms: number | undefined, cells: number | undefined) {
  if (!ohms || !cells || volts < 0.5) return null;
  const floor = cells * CELL_FLOOR;
  const resting = volts + amps * ohms;
  if (resting <= floor) return 0;
  return floor * ((resting - floor) / ohms);
}

/** A pack's health from its record: its resistance trend, and the flights left before it is worn at this rate. */
export interface PackHealth {
  record: PackRecord;
  /** mΩ a cell gained a flight, from the best line through its readings. */
  trend: number | null;
  /** Flights left until its resistance is twice its first, at that trend; null when it is not climbing. */
  flightsLeft: number | null;
  /** The mAh it gives a flight, and its lowest cell under load, the medians of its flights. */
  mah: number | null;
  low: number | null;
}

const median = (values: number[]) =>
  values.length ? [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)] : null;

export function packHealth(record: PackRecord): PackHealth {
  const readings = record.readings;
  // A trend needs three readings at least: two say nothing yet.
  let trend: number | null = null;
  if (readings.length >= 3) {
    // Least squares through the readings, a flight apart.
    const count = readings.length;
    const meanX = (count - 1) / 2;
    const meanY = readings.reduce((sum, value) => sum + value, 0) / count;
    let top = 0;
    let bottom = 0;
    readings.forEach((value, index) => {
      top += (index - meanX) * (value - meanY);
      bottom += (index - meanX) ** 2;
    });
    trend = bottom ? top / bottom : null;
  }
  const first = record.first;
  const latest = record.latest;
  const flightsLeft =
    trend !== null && trend > 0 && first !== undefined && latest !== undefined
      ? Math.max(0, Math.round((2 * first - latest) / trend))
      : null;
  return {record, trend, flightsLeft, mah: median(record.mahs), low: median(record.lows)};
}

/** A part's time since it last broke on a heli, against how often it breaks there. */
export interface PartTime {
  key: string;
  /** As last written. */
  name: string;
  breaks: number;
  /** The day it last broke (YYYY-MM-DD). */
  last: string;
  /** Air time (s) and packs flown since. */
  since: number;
  packsSince: number;
  /** The air time it lasts on average: the heli's air time up to its last break, over its breaks. */
  every: number;
}

/**
 * Each part that broke on a heli, as a logbook's time since overhaul: air time and packs since it last broke (so since
 * its new one went in), against the air time it lasts on average. The part names are matched loosely (partKey).
 */
export function partTimes(sorties: Sortie[], heliId: string): PartTime[] {
  const own = sorties
    .filter(sortie => sortie.heliId === heliId)
    .sort((left, right) => left.date.localeCompare(right.date));
  const parts = new Map<string, {name: string; breaks: number; last: string; lastIndex: number}>();
  own.forEach((sortie, index) => {
    for (const broken of sortie.broken) {
      const key = partKey(broken.part);
      const known = parts.get(key);
      parts.set(key, {
        name: broken.part,
        breaks: (known?.breaks ?? 0) + broken.qty,
        last: sortie.date,
        lastIndex: index,
      });
    }
  });
  const airtimeOf = (from: number, to: number) => own.slice(from, to).reduce((sum, sortie) => sum + airtime(sortie), 0);
  return [...parts]
    .map(([key, part]) => ({
      key,
      name: part.name,
      breaks: part.breaks,
      last: part.last,
      since: airtimeOf(part.lastIndex + 1, own.length),
      packsSince: own.slice(part.lastIndex + 1).reduce((sum, sortie) => sum + sortie.packs, 0),
      every: airtimeOf(0, part.lastIndex + 1) / part.breaks,
    }))
    .sort((left, right) => right.since / (right.every || 1) - left.since / (left.every || 1));
}

/** A sample of the power curve: the collective (%, up to climb) and the current (A). */
export interface CurvePoint {
  pitch: number;
  amps: number;
}

/**
 * A log's power curve: the current drawn against the collective, while the motor runs, the collective in % of its
 * travel with climb up whatever the channel's reversal. At most `limit` points, spread evenly through the flight.
 */
export function powerCurve(series: TelemetrySeries, limit = 300): CurvePoint[] {
  const pitch = series.channels.ch6 ?? [];
  const current = series.channels.current ?? [];
  const side = hoverSide(series);
  if (!side || !pitch.length || !current.length) return [];
  const running = motorRunning(series.channels);
  const points: CurvePoint[] = [];
  pitch.forEach((value, index) => {
    if (running[index] && current[index] >= LOADED_AMPS)
      points.push({pitch: (side * (value - 1500) * 100) / 512, amps: current[index]});
  });
  const step = Math.max(1, Math.ceil(points.length / limit));
  return points.filter((_, index) => index % step === 0);
}

/** The batteries' cells and size by id, for a pack's log. */
export const packSize = (battery: Battery | undefined) =>
  battery ? {cells: battery.cells, capacity: battery.capacity} : {};

/** A word on a pack in a sortie's debrief, good or worth a look. */
export interface PackNote {
  tone: 'good' | 'caution' | 'warning';
  text: string;
}

/**
 * A sortie's packs, each with its words: drained too deep, a cell under 3.3 V, over its rating, flown much harder
 * than the sortie's others, tiring or worn (its resistance against its first reading or the freshest pack's, from
 * `records`), or within its limits. From what each log keeps, so no samples need reading.
 */
export function packDebrief(
  sortie: Sortie,
  batteries: Battery[],
  records: PackRecord[],
): {name: string; notes: PackNote[]}[] {
  const freshest = Math.min(...records.filter(one => !one.pack.dead && one.latest).map(one => one.latest!));
  const packs = groupPacks(sortie.telemetry).map((flown, index) => {
    const found = buttonBattery(flown.packButton ?? 0, batteries, flown.start?.slice(0, 10) ?? sortie.date);
    const flying = flown.files.reduce((sum, file) => sum + (file.flying ?? 0), 0);
    return {
      flown,
      found,
      name: found ? packLabel(found.battery, found.pack) : `Pack ${index + 1}`,
      // The average current in the air: the mAh used over the time flying.
      average: flown.mAh && flying ? (flown.mAh / 1000) * (3600 / flying) : null,
    };
  });
  const averages = packs
    .flatMap(pack => (pack.average === null ? [] : [pack.average]))
    .sort((left, right) => left - right);
  const typical = averages.length ? averages[Math.floor(averages.length / 2)] : null;

  return packs.map(({flown, found, name, average}) => {
    const notes: PackNote[] = [];
    const cells = found?.battery.cells;
    const capacity = found?.battery.capacity;
    if (flown.mAh !== undefined && capacity) {
      const used = flown.mAh / capacity;
      if (used > DEEP) notes.push({tone: 'warning', text: `${Math.round(used * 100)} % used: too deep`});
      else if (used > DEEP_CAUTION) notes.push({tone: 'caution', text: `${Math.round(used * 100)} % used`});
    }
    if (flown.minVoltage !== undefined && flown.minVoltage > 0.5 && cells) {
      const low = flown.minVoltage / cells;
      if (low < 3.0) notes.push({tone: 'warning', text: `sagged to ${low.toFixed(2)} V a cell`});
      else if (low < CELL_FLOOR) notes.push({tone: 'caution', text: `dipped to ${low.toFixed(2)} V a cell`});
    }
    const limit = currentLimit(capacity);
    if (limit && flown.maxCurrent !== undefined && flown.maxCurrent > limit) {
      notes.push({tone: 'caution', text: `${flown.maxCurrent.toFixed(1)} A, past its ${Math.round(limit)} A rating`});
    }
    if (average !== null && typical !== null && packs.length > 1 && average >= typical * 1.25) {
      notes.push({tone: 'caution', text: `flown hard: ${average.toFixed(1)} A on average`});
    }
    const readings = flown.files.flatMap(file => (file.resistance === undefined ? [] : [file.resistance]));
    if (readings.length && found && cells) {
      const reading = readings.sort((left, right) => left - right)[Math.floor(readings.length / 2)] / cells;
      const record = records.find(one => one.battery.id === found.battery.id && one.pack.number === found.pack.number);
      const wear = Math.max(
        record?.first ? reading / record.first : 1,
        Number.isFinite(freshest) ? reading / freshest : 1,
      );
      if (wear >= 2) notes.push({tone: 'warning', text: `worn: ${Math.round(reading)} mΩ a cell, ${wear.toFixed(1)}×`});
      else if (wear >= 1.5)
        notes.push({tone: 'caution', text: `tiring: ${Math.round(reading)} mΩ a cell, ${wear.toFixed(1)}×`});
    }
    if (!notes.length) notes.push({tone: 'good', text: 'within its limits'});
    return {name, notes};
  });
}
