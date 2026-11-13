import {describe, expect, it} from 'vitest';
import type {Battery, BrokenPart, Sortie, TelemetryLog} from '../types';
import {availablePower, cautions, exceedances, packDebrief, packHealth, partTimes} from './cockpit';
import type {PackRecord} from './packs';

// 20 s at five samples a second: a full 3S pack at rest for a second, then 11.1 V and 10 A, a cell dipping under 3.3 V
// twice close together (5 and 7 s), the current over a 700 mAh pack's 21 A once (12 s).
const time = [...Array(101).keys()].map(index => Math.round(index * 2) / 10);
const within = (second: number, from: number, to: number) => second >= from - 0.001 && second <= to + 0.001;
const series = {
  id: 'log',
  time,
  channels: {
    voltage: time.map(second => (second <= 1 ? 12.5 : within(second, 5, 5.6) || within(second, 7, 7.6) ? 9.6 : 11.1)),
    current: time.map(second => (second <= 1 ? 0 : within(second, 12, 13) ? 25 : 10)),
  },
};
const pack = {cells: 3, capacity: 700};

describe('availablePower', () => {
  it('works out the power left before a cell drops to 3.3 V from the resistance', () => {
    // At rest 11.1 + 10 × 0.06 = 11.7 V; down to 9.9 V takes 30 A: 297 W.
    expect(availablePower(11.1, 10, 0.06, 3)).toBeCloseTo(297, 0);
    expect(availablePower(11.1, 10, undefined, 3)).toBeNull();
  });
});

describe('exceedances', () => {
  it('flags the current over the pack and merges dips close together', () => {
    const events = exceedances(series, pack);
    expect(events.map(event => `${event.kind}@${event.start}×${event.times}`)).toEqual(['cell@5×2', 'current@12×1']);
  });

  it('lights the caution panel from them', () => {
    const lit = cautions(series, pack).filter(light => light.level !== 'off');
    expect(lit.map(light => `${light.label}:${light.level}`)).toEqual(['LOW VOLT:warning', 'HIGH AMP:warning']);
  });
});

const battery = {
  id: 'gens',
  name: 'Gens Ace 3S 700 mAh 60C',
  cells: 3,
  capacity: 700,
  packs: [],
  heliIds: [],
} as Battery;
const record = (readings: number[]): PackRecord => ({
  battery,
  pack: {number: 1, button: 1},
  label: 'Gens Ace #1',
  flights: readings.length,
  first: readings[0],
  latest: readings[readings.length - 1],
  readings,
  mahs: [],
  lows: [],
});

describe('packHealth', () => {
  it('reads the trend and the flights left before twice the first reading', () => {
    const health = packHealth(record([20, 25, 30]));
    expect(health.trend).toBeCloseTo(5);
    expect(health.flightsLeft).toBe(2);
  });

  it('says nothing from two readings', () => {
    expect(packHealth(record([20, 26])).trend).toBeNull();
  });
});

const sortie = (date: string, packs: number, broken: BrokenPart[] = [], telemetry: TelemetryLog[] = []): Sortie => ({
  id: date,
  date,
  heliId: 'h',
  packs,
  timer: 300,
  crashes: broken.length ? 1 : 0,
  broken,
  skills: [],
  notes: '',
  links: [],
  telemetry,
  loggedAt: date,
});

describe('partTimes', () => {
  it('counts the time since a part last broke against how long it lasts', () => {
    const sorties = [
      sortie('2026-01-01', 2, [{part: 'Main shaft', qty: 1}]),
      sortie('2026-01-02', 4),
      sortie('2026-01-03', 2, [{part: 'main shafts', qty: 1}]),
      sortie('2026-01-04', 3),
    ];
    const [shaft] = partTimes(sorties, 'h');
    expect(shaft.breaks).toBe(2);
    expect(shaft.last).toBe('2026-01-03');
    // 3 packs of 5 min since; 8 packs (40 min) up to its last break, over 2 breaks: 20 min.
    expect(shaft.since).toBe(900);
    expect(shaft.packsSince).toBe(3);
    expect(shaft.every).toBe(1200);
  });
});

describe('packDebrief', () => {
  it('says what went wrong for a pack, or that it stayed within its limits', () => {
    const log = (id: string, extra: Partial<TelemetryLog>) =>
      ({
        id,
        name: `${id}.csv`,
        start: `2026-11-13T16:${id}:00`,
        duration: 200,
        samples: 1000,
        packButton: 1,
        ...extra,
      }) as TelemetryLog;
    const batteries = [{...battery, packs: [{number: 1, button: 1}]}];
    const deep = packDebrief(
      sortie('2026-11-13', 1, [], [log('10', {mAh: 630, minVoltage: 8.4, maxCurrent: 12, flying: 200})]),
      batteries,
      [],
    );
    expect(deep[0].notes.map(note => note.tone)).toEqual(['warning', 'warning']);
    const fine = packDebrief(
      sortie('2026-11-13', 1, [], [log('10', {mAh: 400, minVoltage: 10.2, maxCurrent: 12, flying: 200})]),
      batteries,
      [],
    );
    expect(fine[0].notes).toEqual([{tone: 'good', text: 'within its limits'}]);
  });
});
