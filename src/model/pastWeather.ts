/**
 * The weather a sortie flew in: wind, gusts, temperature and rain at its spot over the hours it flew, from Open-Meteo's
 * historical forecasts (its high resolution models' hour by hour record, kept from 2022, the ERA5 reanalysis before;
 * no key, and up to today). Kept on the sortie once read, so the crashes can be set against the wind.
 */
import type {Sortie, SortieWeather, Spot} from '../types';
import {hasLocation, type LatLng} from './geo';
import {sortiePacks} from './packs';

/** The hours a sortie with no log is taken to have flown: the afternoon, when the logs that say start. */
export const DEFAULT_HOURS = {from: 12, to: 17};

/**
 * The hours a sortie flew, the spot's local time, both counted: from its first log's start to its last one's end, the
 * radio's clock moved back by how far it runs ahead.
 */
export function flyingHours(sortie: Sortie, clockAhead = 0): {from: number; to: number} {
  const spans = sortiePacks(sortie).flatMap(pack =>
    pack.files.flatMap(file => {
      const at = /T(\d\d):(\d\d)/.exec(file.start ?? '');
      if (!at) return [];
      const start = Number(at[1]) + Number(at[2]) / 60 - clockAhead;
      return [[start, start + file.duration / 3600]];
    }),
  );
  if (!spans.length) return DEFAULT_HOURS;
  return {
    from: Math.max(0, Math.floor(Math.min(...spans.map(([start]) => start)))),
    to: Math.min(23, Math.floor(Math.max(...spans.map(([, end]) => end)))),
  };
}

/** The request for a spot's hour by hour weather on one day. */
export const pastWeatherUrl = ({lat, lng}: LatLng, day: string) =>
  'https://historical-forecast-api.open-meteo.com/v1/forecast?' +
  new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    start_date: day,
    end_date: day,
    hourly: 'temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation,cloud_cover',
    wind_speed_unit: 'kmh',
    timezone: 'auto',
  });

const round = (value: number) => Math.round(value * 10) / 10;
const numbers = (values: unknown) =>
  Array.isArray(values) ? values.map(value => (typeof value === 'number' ? value : null)) : [];

/** A sortie's weather from Open-Meteo's answer for its day, over the given hours; null when the answer has none. */
export function readPastWeather(
  json: unknown,
  spotId: string,
  {from, to}: {from: number; to: number},
): SortieWeather | null {
  const hourly = (json as {hourly?: Record<string, unknown>} | null)?.hourly;
  if (!hourly || !Array.isArray(hourly.time)) return null;
  const wind = numbers(hourly.wind_speed_10m);
  const gusts = numbers(hourly.wind_gusts_10m);
  const temp = numbers(hourly.temperature_2m);
  const cloud = numbers(hourly.cloud_cover);
  const rain = numbers(hourly.precipitation);
  const hours = (hourly.time as unknown[]).flatMap((time, index) => {
    const hour = Number(String(time).slice(11, 13));
    return hour >= from && hour <= to ? [index] : [];
  });
  // The hours with every value the panel needs; the cloud cover is left out where a model has none.
  const picked = hours.flatMap(index => {
    const values = [wind[index], gusts[index], temp[index], rain[index]];
    return values.every(value => value !== null) ? [values as number[]] : [];
  });
  if (!picked.length) return null;
  const mean = (at: number) => picked.reduce((sum, values) => sum + values[at], 0) / picked.length;
  const clouds = hours.flatMap(index => (cloud[index] === null || cloud[index] === undefined ? [] : [cloud[index]!]));
  return {
    spotId,
    from,
    to,
    wind: round(mean(0)),
    gusts: round(Math.max(...picked.map(values => values[1]))),
    temp: round(mean(2)),
    rain: round(picked.reduce((sum, values) => sum + values[3], 0)),
    ...(clouds.length ? {cloud: Math.round(clouds.reduce((sum, value) => sum + value, 0) / clouds.length)} : {}),
  };
}

/**
 * The spot to read a sortie's weather at, when it needs one: flown outdoors at a located spot, on a day whose hours
 * are past (today's once its last hour is), and with no weather yet or one read for another spot or other hours.
 */
export function weatherSpotFor(
  sortie: Sortie,
  spot: Spot | undefined,
  now = new Date(),
  clockAhead = 0,
): (Spot & LatLng) | null {
  if (sortie.indoor || !hasLocation(spot)) return null;
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const hours = flyingHours(sortie, clockAhead);
  if (sortie.date > day || (sortie.date === day && now.getHours() <= hours.to)) return null;
  const kept = sortie.weather;
  const same = kept && kept.spotId === spot.id && kept.from === hours.from && kept.to === hours.to;
  if (same && kept.cloud !== undefined) return null;
  return spot;
}

/** The weather of a sortie, read now: null when Open-Meteo cannot be reached or has nothing for it. */
export async function fetchSortieWeather(
  sortie: Sortie,
  spot: Spot & LatLng,
  clockAhead = 0,
): Promise<SortieWeather | null> {
  const response = await fetch(pastWeatherUrl(spot, sortie.date));
  if (!response.ok) return null;
  return readPastWeather(await response.json(), spot.id, flyingHours(sortie, clockAhead));
}

/**
 * The weather as one emoji, by what matters most to a heli: rain (a shower, or proper rain from 1 mm), then a strong
 * wind (25 km/h, or gusts of 50), then frost (2 °C and under), then how cloudy it was.
 */
export function weatherEmoji({rain, wind, gusts, temp, cloud}: SortieWeather): string {
  if (rain >= 1) return '🌧️';
  if (rain >= 0.1) return '🌦️';
  if (wind >= 25 || gusts >= 50) return '💨';
  if (temp <= 2) return '❄️';
  if (cloud === undefined) return '🌡️';
  return cloud < 20 ? '☀️' : cloud < 50 ? '🌤️' : cloud < 80 ? '⛅' : '☁️';
}

/** The weather in words, for a tooltip: "Wind 14 km/h, gusts 28, 12 °C, dry, 40 % cloud". */
export const weatherTitle = (weather: SortieWeather) =>
  `Wind ${Math.round(weather.wind)} km/h, ${weatherNote(weather)}${weather.cloud === undefined ? '' : `, ${weather.cloud} % cloud`}`;

/** The rest of a sortie's weather in a few words: "gusts 28, 12 °C, dry". */
export const weatherNote = ({gusts, temp, rain}: SortieWeather) =>
  `gusts ${Math.round(gusts)}, ${Math.round(temp)} °C, ${rain >= 0.1 ? `${rain} mm rain` : 'dry'}`;

/** A wind band: from (km/h, counted) to the next band's start. */
export const WIND_BANDS = [
  {from: 0, label: 'Under 10 km/h'},
  {from: 10, label: '10 to 15'},
  {from: 15, label: '15 to 20'},
  {from: 20, label: '20 to 25'},
  {from: 25, label: '25 km/h and more'},
];

export interface WindBand {
  label: string;
  from: number;
  sorties: number;
  packs: number;
  crashes: number;
}

/** The outdoor sorties with their weather and a known crash count, by the mean wind they flew in. */
export function crashesByWind(sorties: Sortie[]): WindBand[] {
  const bands: WindBand[] = WIND_BANDS.map(band => ({...band, sorties: 0, packs: 0, crashes: 0}));
  for (const sortie of sorties) {
    if (sortie.indoor || !sortie.weather || sortie.crashes === null) continue;
    const band = [...bands].reverse().find(one => sortie.weather!.wind >= one.from)!;
    band.sorties += 1;
    band.packs += sortie.packs;
    band.crashes += sortie.crashes;
  }
  return bands;
}

/** A wind band needs this many sorties before its record says anything. */
export const RECORD_SORTIES = 3;

/** Your own record in a wind: go, careful or no-go, from how often you crash in that band against your usual. */
export interface WindRecord {
  band: WindBand;
  /** Packs flown for each crash in that band; null with no crash there. */
  perCrash: number | null;
  /** Crashes a pack in that band, against all your outdoor packs with their weather: 2 is twice as often. */
  ratio: number;
  verdict: 'go' | 'careful' | 'no-go';
}

/**
 * How you have flown in this wind (km/h), from the bands of `crashesByWind`: null while its band has too few sorties
 * to say. Go up to a quarter more crashes than usual, careful up to twice, no-go beyond.
 */
export function windRecord(bands: WindBand[], wind: number): WindRecord | null {
  const band = [...bands].reverse().find(one => wind >= one.from);
  if (!band || band.sorties < RECORD_SORTIES || !band.packs) return null;
  const packs = bands.reduce((sum, one) => sum + one.packs, 0);
  const crashes = bands.reduce((sum, one) => sum + one.crashes, 0);
  const usual = crashes / packs;
  const here = band.crashes / band.packs;
  // No crash at all yet: every band is as usual.
  const ratio = usual ? here / usual : 1;
  return {
    band,
    perCrash: band.crashes ? band.packs / band.crashes : null,
    ratio,
    verdict: ratio <= 1.25 ? 'go' : ratio <= 2 ? 'careful' : 'no-go',
  };
}

/** A record in words: "you crash twice as often as usual here (a crash every 3 packs)". */
export function recordText({perCrash, ratio}: WindRecord): string {
  const often =
    ratio < 0.8
      ? 'you crash less than usual in this wind'
      : ratio <= 1.25
        ? 'you crash about as often as usual in this wind'
        : ratio < 1.75
          ? `you crash ${Math.round(ratio * 10) / 10}× as often as usual in this wind`
          : ratio < 2.5
            ? 'you crash twice as often as usual in this wind'
            : `you crash ${Math.round(ratio)}× as often as usual in this wind`;
  const every = perCrash === null ? 'no crash yet' : `a crash every ${Math.round(perCrash * 10) / 10} packs`;
  return `${often} (${every})`;
}
