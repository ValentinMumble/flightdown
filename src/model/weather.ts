/**
 * Flying weather: the forecast at the pilot's spots from Open-Meteo, hour by hour through daylight, each hour rated for
 * a small electric heli (an M2 EVO, about 300 size, and a K110S micro). Times are the spot's local time, as Open-Meteo
 * gives them with `timezone=auto` (YYYY-MM-DDTHH:MM).
 */
import type {Sortie, Spot} from '../types';
import {hasLocation, type LatLng} from './geo';
import {daysBetween, fromDay, pad} from './format';
import {sortSorties} from './stats';

/**
 * Good: dry, and calm enough for a small heli, which copes well with wind. Wind and gusts in km/h, the chance of rain
 * in %.
 */
export const GOOD_WIND = 20;
export const GOOD_GUSTS = 32;
export const GOOD_RAIN_CHANCE = 20;

/** Fair: a stiffer wind, or a shower possible. */
export const FAIR_WIND = 30;
export const FAIR_GUSTS = 45;
export const FAIR_RAIN_CHANCE = 50;

/** Any rain forecast for the hour (mm) rules it out, as a likely one does: water and the electronics do not mix. */
export const NO_RAIN = 0.1;

/** How many spots the panel shows (the latest one), and how many days. */
export const WEATHER_SPOTS = 1;
export const FORECAST_DAYS = 3;

/** A kept forecast younger than this is used as it is, with no new request. */
export const REFRESH_MS = 30 * 60_000;

export type Rating = 'good' | 'fair' | 'no';

/** What keeps an hour from good. */
export type Reason = 'rain' | 'wind' | 'gusts';

export interface HourWeather {
  /** YYYY-MM-DDTHH:MM, the spot's local time. */
  time: string;
  /** 0 to 23. */
  hour: number;
  /** km/h, at 10 m. */
  wind: number;
  gusts: number;
  /** The chance of rain, in %. */
  rainChance: number;
  /** mm over the hour. */
  rain: number;
}

/** What rules an hour out, rain first: rain forecast or likely, then wind or gusts past fair. */
const ruledOutBy = ({wind, gusts, rainChance, rain}: HourWeather): Reason | null =>
  rain >= NO_RAIN || rainChance >= FAIR_RAIN_CHANCE
    ? 'rain'
    : wind > FAIR_WIND
      ? 'wind'
      : gusts > FAIR_GUSTS
        ? 'gusts'
        : null;

/** What keeps a flyable hour from good: a shower possible, then wind or gusts past good. */
const fairBy = ({wind, gusts, rainChance}: HourWeather): Reason | null =>
  rainChance >= GOOD_RAIN_CHANCE ? 'rain' : wind > GOOD_WIND ? 'wind' : gusts > GOOD_GUSTS ? 'gusts' : null;

/** How one hour suits a small heli. */
export const rateHour = (hour: HourWeather): Rating => (ruledOutBy(hour) ? 'no' : fairBy(hour) ? 'fair' : 'good');

/** Why an hour is not good (rain, wind or gusts, rain first), or null for a good one. */
export const whyNot = (hour: HourWeather): Reason | null => ruledOutBy(hour) ?? fairBy(hour);

/**
 * The spots to show: the spot of the latest sortie that has one, else the most used, only spots with a GPS point.
 */
export function weatherSpots(spots: Spot[], sorties: Sortie[], count = WEATHER_SPOTS): (Spot & LatLng)[] {
  const uses = new Map<string, number>();
  for (const sortie of sorties) if (sortie.spotId) uses.set(sortie.spotId, (uses.get(sortie.spotId) ?? 0) + 1);
  const latest = sortSorties(sorties)
    .reverse()
    .find(sortie => sortie.spotId)?.spotId;
  const ranked = [...spots].sort(
    (left, right) =>
      Number(right.id === latest) - Number(left.id === latest) ||
      (uses.get(right.id) ?? 0) - (uses.get(left.id) ?? 0) ||
      left.name.localeCompare(right.name),
  );
  return ranked.filter(hasLocation).slice(0, count);
}

/** The part of Open-Meteo's answer the panel reads. A value it does not know is null. */
export interface OpenMeteo {
  utc_offset_seconds: number;
  hourly: {
    time: string[];
    wind_speed_10m: (number | null)[];
    wind_gusts_10m: (number | null)[];
    precipitation_probability: (number | null)[];
    precipitation: (number | null)[];
  };
  daily: {time: string[]; sunrise: string[]; sunset: string[]};
}

/** The request for a spot's next 3 days. */
export const forecastUrl = ({lat, lng}: LatLng) =>
  'https://api.open-meteo.com/v1/forecast?' +
  new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: 'wind_speed_10m,wind_gusts_10m,precipitation_probability,precipitation',
    daily: 'sunrise,sunset',
    wind_speed_unit: 'kmh',
    timezone: 'auto',
    forecast_days: String(FORECAST_DAYS),
  });

const isList = (value: unknown): value is unknown[] => Array.isArray(value);

/** Open-Meteo's answer cut down to what the panel reads, or null when it does not look like a forecast. */
export function readOpenMeteo(json: unknown): OpenMeteo | null {
  if (typeof json !== 'object' || json === null) return null;
  const answer = json as Partial<OpenMeteo>;
  const {hourly, daily} = answer;
  if (!hourly || !daily || typeof answer.utc_offset_seconds !== 'number') return null;
  const hourLists = [
    hourly.time,
    hourly.wind_speed_10m,
    hourly.wind_gusts_10m,
    hourly.precipitation_probability,
    hourly.precipitation,
  ];
  if (!hourLists.every(isList) || !isList(daily.time) || !isList(daily.sunrise) || !isList(daily.sunset)) return null;
  return {
    utc_offset_seconds: answer.utc_offset_seconds,
    hourly: {
      time: hourly.time,
      wind_speed_10m: hourly.wind_speed_10m,
      wind_gusts_10m: hourly.wind_gusts_10m,
      precipitation_probability: hourly.precipitation_probability,
      precipitation: hourly.precipitation,
    },
    daily: {time: daily.time, sunrise: daily.sunrise, sunset: daily.sunset},
  };
}

/** A run of good hours: "10:00" to "14:00", and its mean wind. */
export interface Stretch {
  from: string;
  to: string;
  wind: number;
}

export interface DayWeather {
  /** YYYY-MM-DD */
  date: string;
  /** "Today", "Tomorrow", then the weekday. */
  label: string;
  /** Its daylight hours, each rated, and whether it is already gone (today only). */
  hours: (HourWeather & {rating: Rating; reason: Reason | null; past: boolean})[];
  /** The longest run of good hours still to come, the calmer one on a tie. */
  best: Stretch | null;
  /** Today, once every daylight hour has gone by. */
  over: boolean;
}

/** The time it is now at the spot, written as Open-Meteo writes its times (YYYY-MM-DDTHH:MM). */
export const spotTime = (now: number, offsetSeconds: number) =>
  new Date(now + offsetSeconds * 1000).toISOString().slice(0, 16);

/** HH:MM to minutes since midnight. */
const minutesOf = (time: string) => Number(time.slice(11, 13)) * 60 + Number(time.slice(14, 16));

const hourText = (hour: number) => `${pad(hour)}:00`;

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** The longest run of good hours, the calmer one on a tie, the earlier one after that. */
function bestStretch(hours: (HourWeather & {rating: Rating})[]): Stretch | null {
  let best: HourWeather[] = [];
  let run: HourWeather[] = [];
  for (const hour of [...hours, null]) {
    if (hour?.rating === 'good' && (!run.length || hour.hour === run[run.length - 1].hour + 1)) {
      run.push(hour);
      continue;
    }
    const longer = run.length > best.length;
    const calmer =
      run.length === best.length &&
      run.length > 0 &&
      mean(run.map(each => each.wind)) < mean(best.map(each => each.wind));
    if (longer || calmer) best = run;
    run = hour?.rating === 'good' ? [hour] : [];
  }
  if (!best.length) return null;
  return {
    from: hourText(best[0].hour),
    to: hourText(best[best.length - 1].hour + 1),
    wind: Math.round(mean(best.map(each => each.wind))),
  };
}

/**
 * The forecast's days from today on (at the spot), each with its daylight hours rated: an hour counts when its middle
 * falls between sunrise and sunset. An hour the forecast has no wind for is left out; unknown rain counts as none.
 */
export function flyingDays(forecast: OpenMeteo, now: number): DayWeather[] {
  const current = spotTime(now, forecast.utc_offset_seconds);
  const today = current.slice(0, 10);
  const {hourly, daily} = forecast;
  return daily.time.flatMap((date, index) => {
    const ahead = daysBetween(today, date);
    if (ahead < 0) return [];
    const sunrise = minutesOf(daily.sunrise[index] ?? '');
    const sunset = minutesOf(daily.sunset[index] ?? '');
    const hours = hourly.time.flatMap((time, at) => {
      const middle = minutesOf(time) + 30;
      const wind = hourly.wind_speed_10m[at];
      const gusts = hourly.wind_gusts_10m[at];
      if (!time.startsWith(date) || middle < sunrise || middle > sunset || wind == null || gusts == null) return [];
      const hour: HourWeather = {
        time,
        hour: Number(time.slice(11, 13)),
        wind,
        gusts,
        rainChance: hourly.precipitation_probability[at] ?? 0,
        rain: hourly.precipitation[at] ?? 0,
      };
      // An hour is gone once it has ended.
      const past = time.slice(0, 13) < current.slice(0, 13);
      return [{...hour, rating: rateHour(hour), reason: whyNot(hour), past}];
    });
    const label =
      ahead === 0 ? 'Today' : ahead === 1 ? 'Tomorrow' : fromDay(date).toLocaleDateString('en-GB', {weekday: 'long'});
    const coming = hours.filter(hour => !hour.past);
    return [{date, label, hours, best: bestStretch(coming), over: hours.length > 0 && !coming.length}];
  });
}

/** What kept a day's hours still to come from good, the most common first, at most two: "rain", "wind and gusts". */
export function dayReasons(day: DayWeather): string {
  const counts = new Map<Reason, number>();
  for (const hour of day.hours) {
    if (!hour.past && hour.reason) counts.set(hour.reason, (counts.get(hour.reason) ?? 0) + 1);
  }
  return [...counts]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([reason]) => reason)
    .join(' and ');
}

/** The day's best stretch in words, or why it has none ("No good hours: rain"). */
export function dayVerdict(day: DayWeather): string {
  if (day.over) return 'Daylight is over';
  if (day.best) return `Best ${day.best.from} to ${day.best.to}, wind ${day.best.wind} km/h`;
  const earlier = day.hours.some(hour => hour.past && hour.rating === 'good');
  const why = dayReasons(day);
  return `${earlier ? 'No good hours left' : 'No good hours'}${why ? `: ${why}` : ''}`;
}

/** What a cell says on hover: "14:00 · wind 12 km/h, gusts 20 km/h, rain 10 % (0.1 mm)". */
export const hourTitle = (hour: HourWeather) =>
  `${hourText(hour.hour)} · wind ${Math.round(hour.wind)} km/h, gusts ${Math.round(hour.gusts)} km/h, rain ${Math.round(hour.rainChance)} % (${hour.rain} mm)`;
