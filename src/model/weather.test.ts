import {describe, expect, it} from 'vitest';
import type {Sortie, Spot} from '../types';
import {
  dayVerdict,
  flyingDays,
  forecastUrl,
  rateHour,
  readOpenMeteo,
  whyNot,
  spotTime,
  weatherSpots,
  type HourWeather,
  type OpenMeteo,
} from './weather';

const hour = (values: Partial<HourWeather>): HourWeather => ({
  time: '2026-11-20T12:00',
  hour: 12,
  wind: 10,
  gusts: 20,
  rainChance: 0,
  rain: 0,
  ...values,
});

describe('rateHour', () => {
  it('rates dry hours good, a heli coping well with wind', () => {
    expect(rateHour(hour({}))).toBe('good');
    expect(rateHour(hour({wind: 20, gusts: 32, rainChance: 19, rain: 0.05}))).toBe('good');
  });

  it('rates a stiffer wind or a possible shower fair', () => {
    expect(rateHour(hour({wind: 21}))).toBe('fair');
    expect(rateHour(hour({gusts: 33}))).toBe('fair');
    expect(rateHour(hour({rainChance: 20}))).toBe('fair');
    expect(rateHour(hour({wind: 30, gusts: 45, rainChance: 49}))).toBe('fair');
  });

  it('rules out any rain forecast or likely, and wind past fair', () => {
    expect(rateHour(hour({rain: 0.1}))).toBe('no');
    expect(rateHour(hour({rainChance: 50}))).toBe('no');
    expect(rateHour(hour({wind: 31}))).toBe('no');
    expect(rateHour(hour({gusts: 46}))).toBe('no');
  });

  it('says why an hour is not good, rain first', () => {
    expect(whyNot(hour({}))).toBeNull();
    expect(whyNot(hour({rain: 0.3, wind: 40}))).toBe('rain');
    expect(whyNot(hour({wind: 35, rainChance: 30}))).toBe('wind');
    expect(whyNot(hour({rainChance: 30, wind: 25}))).toBe('rain');
    expect(whyNot(hour({gusts: 40}))).toBe('gusts');
  });
});

const spot = (id: string, located = true): Spot => ({id, name: id, ...(located && {lat: 47.2, lng: -1.5})});

const sortie = (date: string, spotId?: string): Sortie => ({
  id: `${date}-${spotId}`,
  date,
  heliId: 'heli',
  spotId,
  packs: 1,
  timer: 240,
  crashes: 0,
  broken: [],
  skills: [],
  notes: '',
  links: [],
  telemetry: [],
  loggedAt: `${date}T18:00:00Z`,
});

describe('weatherSpots', () => {
  const spots = [spot('beach'), spot('field'), spot('park'), spot('garden', false)];

  it('shows only the latest sortie spot', () => {
    const sorties = [
      sortie('2026-11-01', 'field'),
      sortie('2026-11-02', 'field'),
      sortie('2026-11-03', 'park'),
      sortie('2026-11-04', 'beach'),
      sortie('2026-11-05'),
    ];
    expect(weatherSpots(spots, sorties).map(each => each.id)).toEqual(['beach']);
  });

  it('skips spots with no GPS point, showing the most used instead', () => {
    const sorties = [sortie('2026-11-01', 'park'), sortie('2026-11-02', 'park'), sortie('2026-11-03', 'garden')];
    expect(weatherSpots(spots, sorties).map(each => each.id)).toEqual(['park']);
  });

  it('is empty when no spot has a GPS point', () => {
    expect(weatherSpots([spot('garden', false)], [sortie('2026-11-01', 'garden')])).toEqual([]);
  });
});

/** Three days in Paris in November: sunrise 08:07, sunset 17:04, calm and dry but for the hours given. */
function forecast(hours: Record<string, Partial<HourWeather>> = {}): OpenMeteo {
  const days = ['2026-11-20', '2026-11-21', '2026-11-22'];
  const times = days.flatMap(day => Array.from({length: 24}, (_, at) => `${day}T${String(at).padStart(2, '0')}:00`));
  const value = (time: string) => ({wind: 8, gusts: 14, rainChance: 0, rain: 0, ...hours[time]});
  return {
    utc_offset_seconds: 3600,
    hourly: {
      time: times,
      wind_speed_10m: times.map(time => value(time).wind),
      wind_gusts_10m: times.map(time => value(time).gusts),
      precipitation_probability: times.map(time => value(time).rainChance),
      precipitation: times.map(time => value(time).rain),
    },
    daily: {
      time: days,
      sunrise: days.map(day => `${day}T08:07`),
      sunset: days.map(day => `${day}T17:04`),
    },
  };
}

/** 06:30 in Paris on 20 November 2026 (05:30 UTC). */
const MORNING = Date.UTC(2026, 10, 20, 5, 30);

describe('flyingDays', () => {
  it('names the days and keeps the daylight hours only', () => {
    const days = flyingDays(forecast(), MORNING);
    expect(days.map(day => day.label)).toEqual(['Today', 'Tomorrow', 'Sunday']);
    // 08:00 counts (its middle, 08:30, is after sunrise), 17:00 does not (17:30 is after sunset).
    expect(days[0].hours.map(each => each.hour)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it('finds the longest run of good hours', () => {
    const days = flyingDays(
      forecast({
        '2026-11-20T08:00': {wind: 25},
        '2026-11-20T10:00': {rainChance: 60},
        '2026-11-20T16:00': {gusts: 40},
      }),
      MORNING,
    );
    expect(days[0].hours.map(each => each.rating).join(' ')).toBe('fair good no good good good good good fair');
    expect(days[0].best).toEqual({from: '11:00', to: '16:00', wind: 8});
    expect(dayVerdict(days[0])).toBe('Best 11:00 to 16:00, wind 8 km/h');
  });

  it('takes the calmer run of two as long', () => {
    const days = flyingDays(
      forecast({
        '2026-11-21T08:00': {wind: 12},
        '2026-11-21T09:00': {wind: 12},
        '2026-11-21T10:00': {wind: 30},
        '2026-11-21T11:00': {wind: 30},
        '2026-11-21T12:00': {wind: 30},
        '2026-11-21T13:00': {wind: 30},
        '2026-11-21T14:00': {wind: 30},
        '2026-11-21T15:00': {wind: 4},
        '2026-11-21T16:00': {wind: 6},
      }),
      MORNING,
    );
    expect(days[1].best).toEqual({from: '15:00', to: '17:00', wind: 5});
  });

  it('says when no hour is good', () => {
    const windy = Object.fromEntries(
      Array.from({length: 24}, (_, at) => [`2026-11-22T${String(at).padStart(2, '0')}:00`, {wind: 30}]),
    );
    const days = flyingDays(forecast(windy), MORNING);
    expect(days[2].best).toBeNull();
    expect(dayVerdict(days[2])).toBe('No good hours: wind');
  });

  it('says rain kept a day from good, the most common reason first', () => {
    const wet = Object.fromEntries(
      Array.from({length: 24}, (_, at) => [
        `2026-11-22T${String(at).padStart(2, '0')}:00`,
        at < 13 ? {rain: 0.4} : {gusts: 40},
      ]),
    );
    expect(dayVerdict(flyingDays(forecast(wet), MORNING)[2])).toBe('No good hours: rain and gusts');
  });

  it('only counts the hours still to come today', () => {
    // 14:20 in Paris: 08:00 to 13:00 are gone, 14:00 is under way.
    const afternoon = Date.UTC(2026, 10, 20, 13, 20);
    const days = flyingDays(forecast({'2026-11-20T15:00': {wind: 25}}), afternoon);
    expect(days[0].hours.filter(each => each.past).map(each => each.hour)).toEqual([8, 9, 10, 11, 12, 13]);
    // 14:00 and 16:00 are good, 15:00 is not: the earlier of the two runs.
    expect(dayVerdict(days[0])).toBe('Best 14:00 to 15:00, wind 8 km/h');
    expect(days[1].hours.some(each => each.past)).toBe(false);
  });

  it('says when good hours are gone, and when daylight is over', () => {
    const windy = Object.fromEntries(
      [14, 15, 16].map(at => [`2026-11-20T${at}:00`, {wind: 30}] as [string, Partial<HourWeather>]),
    );
    const afternoon = Date.UTC(2026, 10, 20, 13, 20);
    expect(dayVerdict(flyingDays(forecast(windy), afternoon)[0])).toBe('No good hours left: wind');
    const evening = Date.UTC(2026, 10, 20, 18, 0);
    expect(dayVerdict(flyingDays(forecast(), evening)[0])).toBe('Daylight is over');
  });

  it('drops the days gone by in a forecast kept from earlier', () => {
    const nextDay = Date.UTC(2026, 10, 21, 9, 0);
    expect(flyingDays(forecast(), nextDay).map(day => day.label)).toEqual(['Today', 'Tomorrow']);
  });

  it('leaves out an hour with no wind, and reads unknown rain as none', () => {
    const data = forecast();
    data.hourly.wind_speed_10m[34] = null;
    data.hourly.precipitation_probability[35] = null;
    const tomorrow = flyingDays(data, MORNING)[1];
    expect(tomorrow.hours.map(each => each.hour)).not.toContain(10);
    expect(tomorrow.hours.find(each => each.hour === 11)?.rating).toBe('good');
  });
});

describe('spotTime', () => {
  it('writes the spot local time as Open-Meteo does', () => {
    expect(spotTime(MORNING, 3600)).toBe('2026-11-20T06:30');
    expect(spotTime(MORNING, -5 * 3600)).toBe('2026-11-20T00:30');
  });
});

describe('readOpenMeteo', () => {
  it('keeps what the panel reads', () => {
    const data = forecast();
    expect(readOpenMeteo({...data, latitude: 48.85, elevation: 46})).toEqual(data);
  });

  it('refuses what is not a forecast', () => {
    expect(readOpenMeteo(null)).toBeNull();
    expect(readOpenMeteo({error: true, reason: 'Latitude must be in range'})).toBeNull();
    expect(readOpenMeteo({...forecast(), hourly: {time: []}})).toBeNull();
  });
});

describe('forecastUrl', () => {
  it('asks for wind, gusts and rain in km/h, in the spot time zone', () => {
    const url = new URL(forecastUrl({lat: 47.2184, lng: -1.5536}));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('latitude')).toBe('47.2184');
    expect(url.searchParams.get('longitude')).toBe('-1.5536');
    expect(url.searchParams.get('hourly')).toBe(
      'wind_speed_10m,wind_gusts_10m,precipitation_probability,precipitation',
    );
    expect(url.searchParams.get('wind_speed_unit')).toBe('kmh');
    expect(url.searchParams.get('timezone')).toBe('auto');
    expect(url.searchParams.get('forecast_days')).toBe('3');
  });
});
