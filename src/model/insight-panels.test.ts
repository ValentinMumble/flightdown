import {describe, expect, it} from 'vitest';
import type {Heli, Sortie, SortieWeather, Spare, TelemetryLog, TelemetrySeries} from '../types';
import {crashesByWind, flyingHours, readPastWeather, weatherEmoji, weatherNote, weatherSpotFor} from './pastWeather';
import {crashPatterns, packsPerCrash} from './patterns';
import {costs, partPrice} from './costs';
import {flyingStats} from './flying';

let count = 0;
const sortie = (overrides: Partial<Sortie>): Sortie => ({
  id: `s${(count += 1)}`,
  date: '2026-11-01',
  heliId: 'h',
  packs: 2,
  timer: 300,
  crashes: 0,
  broken: [],
  skills: [],
  notes: '',
  links: [],
  telemetry: [],
  loggedAt: '',
  ...overrides,
});

const log = (start: string, duration: number): TelemetryLog => ({id: start, name: start, start, duration, samples: 10});
const weather = (wind: number): SortieWeather => ({
  spotId: 'p',
  from: 12,
  to: 17,
  wind,
  gusts: 30,
  temp: 12,
  rain: 0,
  cloud: 30,
});
const spot = {id: 'p', name: 'Field', lat: 47.2, lng: -1.5};

describe('flyingHours', () => {
  it('takes the hours from the first log to the last one, else the afternoon', () => {
    expect(flyingHours(sortie({}))).toEqual({from: 12, to: 17});
    const logged = sortie({telemetry: [log('2026-11-01T16:20:00', 300), log('2026-11-01T17:55:00', 600)]});
    expect(flyingHours(logged)).toEqual({from: 16, to: 18});
  });
});

describe('readPastWeather', () => {
  const answer = {
    hourly: {
      time: ['2026-11-01T11:00', '2026-11-01T12:00', '2026-11-01T13:00', '2026-11-01T18:00'],
      wind_speed_10m: [40, 10, 20, 50],
      wind_gusts_10m: [60, 25, 31.4, 70],
      temperature_2m: [5, 10, 12, 4],
      precipitation: [3, 0, 0.2, 1],
      cloud_cover: [100, 20, 41, 90],
    },
  };
  it('means the wind and temperature over the hours flown, keeps the strongest gust and adds the rain', () => {
    expect(readPastWeather(answer, 'p', {from: 12, to: 17})).toEqual({
      spotId: 'p',
      from: 12,
      to: 17,
      wind: 15,
      gusts: 31.4,
      temp: 11,
      rain: 0.2,
      cloud: 31,
    });
  });
  it('gives nothing for an answer without those hours', () => {
    expect(readPastWeather(answer, 'p', {from: 20, to: 21})).toBeNull();
    expect(readPastWeather({error: true}, 'p', {from: 12, to: 17})).toBeNull();
  });
  it('says the rest in a few words', () => {
    expect(weatherNote({...weather(12), gusts: 28.4, rain: 0})).toBe('gusts 28, 12 °C, dry');
    expect(weatherNote({...weather(12), rain: 1.2})).toBe('gusts 30, 12 °C, 1.2 mm rain');
  });
});

describe('weatherSpotFor', () => {
  const now = new Date(2026, 10, 21, 14, 0);
  it('asks for outdoor sorties at a located spot, once their hours are past', () => {
    expect(weatherSpotFor(sortie({spotId: 'p'}), spot, now)).toBe(spot);
    expect(weatherSpotFor(sortie({spotId: 'p', indoor: true}), spot, now)).toBeNull();
    expect(weatherSpotFor(sortie({spotId: 'p'}), {id: 'p', name: 'Nowhere'}, now)).toBeNull();
    expect(weatherSpotFor(sortie({spotId: 'p', date: '2026-11-21'}), spot, now)).toBeNull();
    expect(weatherSpotFor(sortie({spotId: 'p', date: '2026-11-21'}), spot, new Date(2026, 10, 21, 19))).toBe(spot);
  });
  it('asks again when the spot or the hours changed', () => {
    expect(weatherSpotFor(sortie({spotId: 'p', weather: weather(10)}), spot, now)).toBeNull();
    expect(weatherSpotFor(sortie({spotId: 'p', weather: {...weather(10), spotId: 'q'}}), spot, now)).toBe(spot);
    expect(weatherSpotFor(sortie({spotId: 'p', weather: {...weather(10), from: 15}}), spot, now)).toBe(spot);
    expect(weatherSpotFor(sortie({spotId: 'p', weather: {...weather(10), cloud: undefined}}), spot, now)).toBe(spot);
  });
});

describe('weatherEmoji', () => {
  it('says rain first, then a strong wind, then frost, then the clouds', () => {
    expect(weatherEmoji({...weather(30), rain: 2})).toBe('🌧️');
    expect(weatherEmoji({...weather(30), rain: 0.3})).toBe('🌦️');
    expect(weatherEmoji(weather(26))).toBe('💨');
    expect(weatherEmoji({...weather(10), gusts: 55})).toBe('💨');
    expect(weatherEmoji({...weather(10), temp: 1})).toBe('❄️');
    expect(weatherEmoji({...weather(10), cloud: 5})).toBe('☀️');
    expect(weatherEmoji(weather(10))).toBe('🌤️');
    expect(weatherEmoji({...weather(10), cloud: 60})).toBe('⛅');
    expect(weatherEmoji({...weather(10), cloud: 95})).toBe('☁️');
  });
});

describe('crashesByWind', () => {
  it('counts outdoor sorties with their weather and a known crash count by the wind', () => {
    const bands = crashesByWind([
      sortie({weather: weather(5), crashes: 1}),
      sortie({weather: weather(22), packs: 4, crashes: 2}),
      sortie({weather: weather(22), indoor: true, crashes: 3}),
      sortie({weather: weather(30), crashes: null}),
      sortie({crashes: 1}),
    ]);
    expect(bands.map(band => [band.sorties, band.packs, band.crashes])).toEqual([
      [1, 2, 1],
      [0, 0, 0],
      [0, 0, 0],
      [1, 4, 2],
      [0, 0, 0],
    ]);
  });
});

describe('crashPatterns', () => {
  it('sets each sortie against the one before it, the place and the days since', () => {
    const patterns = crashPatterns([
      sortie({date: '2026-01-01', crashes: 1}),
      sortie({date: '2026-01-02', crashes: 1, indoor: true}),
      sortie({date: '2026-01-20', crashes: 0}),
      sortie({date: '2026-03-01', crashes: 2, packs: 4}),
      sortie({date: '2026-03-02', crashes: null}),
    ]);
    expect(patterns.all).toEqual({sorties: 4, crashed: 3, packs: 10, crashes: 4});
    expect(patterns.afterCrash).toEqual({sorties: 2, crashed: 1, packs: 4, crashes: 1});
    expect(patterns.afterClean).toEqual({sorties: 1, crashed: 1, packs: 4, crashes: 2});
    expect(patterns.indoor.sorties).toBe(1);
    expect(patterns.outdoor.sorties).toBe(3);
    expect(patterns.gaps.map(band => band.sorties)).toEqual([1, 0, 1, 1]);
    expect(packsPerCrash(patterns.all)).toBe(2.5);
  });
});

describe('costs', () => {
  const heli = (id: string, model: string, price?: number): Heli => ({
    id,
    name: id,
    model,
    maker: 'OMPHobby',
    color: 0,
    status: 'active',
    price,
    createdAt: '',
  });
  const helis = [heli('orange', 'M2 EVO', 349), heli('white', 'M2 EVO', 349), heli('m4', 'M4')];
  const spare = (name: string, price: number, heliId?: string): Spare => ({
    id: name,
    name,
    heliId,
    count: 1,
    countedAt: '',
    min: 0,
    price,
  });
  const spares = [spare('Main blade', 6, 'orange'), spare('Tail blade', 1.75, 'orange'), spare('Screws', 2)];

  it('prices a part from its heli, the same model, then a spare for any heli', () => {
    expect(partPrice('Main blades', helis[0], spares, helis)).toBe(6);
    expect(partPrice('Main blade', helis[1], spares, helis)).toBe(6);
    expect(partPrice('Main blade', helis[2], spares, helis)).toBeUndefined();
    expect(partPrice('Screws', helis[2], spares, helis)).toBe(2);
  });

  it('adds up the parts and each heli an hour, its price and parts over its time', () => {
    const money = costs(
      [
        sortie({heliId: 'white', packs: 12, crashes: 2, broken: [{part: 'Main blade', qty: 2}]}),
        sortie({heliId: 'white', packs: 12, crashes: 1, broken: [{part: 'Main shaft', qty: 1}]}),
        sortie({heliId: 'm4', packs: 1, broken: [{part: 'Whole heli', qty: 1}]}),
      ],
      helis,
      spares,
    );
    expect(money.parts).toBe(3);
    expect(money.pricedParts).toBe(2);
    expect(money.partsCost).toBe(12);
    expect(money.perCrash).toBe(4);
    expect(money.unpriced).toEqual([{name: 'Main shaft', qty: 1}]);
    expect(money.byHeli.map(one => [one.heli.id, one.airtime, one.perHour])).toEqual([
      ['white', 7200, 180.5],
      ['m4', 300, null],
    ]);
  });
});

describe('flyingStats', () => {
  // 0.2 s a sample, the motor on from 2 s to 60 s.
  const time = Array.from({length: 320}, (_, index) => index * 0.2);
  const on = (second: number) => second >= 2 && second < 60;
  const series = (channels: Record<string, (second: number) => number>): TelemetrySeries => ({
    id: 'log',
    time,
    channels: Object.fromEntries(Object.entries(channels).map(([name, read]) => [name, time.map(read)])),
  });
  const flown = series({
    ch3: second => (on(second) ? 1600 : 1000),
    current: second => (on(second) ? (second < 30 ? 4 : 8) : 0),
    se: second => (second < 30 ? -1 : 0),
    sh: second => ((second >= 10 && second < 11) || (second >= 40 && second < 42) ? 1 : -1),
    sc: second => (second >= 50 ? 1 : -1),
    sd: second => (second >= 20 && second < 25 ? 1 : -1),
    aileron: second => (Math.round(second / 0.2) % 2 ? 10 : 0),
    elevator: () => 0,
  });

  it('counts the rescues, self-level, practice rates and idle ups with the motor on', () => {
    const stats = flyingStats(flown, '2026-11-22')!;
    expect(stats.flying).toBeCloseTo(58, 5);
    expect(stats.rescues).toBe(2);
    expect(stats.level).toBeCloseTo(10, 5);
    expect(stats.practice).toBeCloseTo(5, 5);
    expect(stats.idleUps[0]).toBeCloseTo(28, 5);
    expect(stats.idleUps[1]).toBeCloseTo(30, 5);
    expect(stats.amps[0]).toBeCloseTo(4, 5);
    expect(stats.amps[1]).toBeCloseTo(8, 5);
    expect(stats.amps[2]).toBeNull();
    // The aileron moves 10 % every 0.2 s: 50 % a second.
    expect(stats.travel).toBeCloseTo(50, 0);
  });

  it('leaves out the practice rates before they were set up, and a log that never ran the motor', () => {
    expect(flyingStats(flown, '2026-11-01')!.practice).toBeNull();
    expect(flyingStats(series({ch3: () => 1000, current: () => 0}), '2026-11-22')).toBeNull();
  });
});
