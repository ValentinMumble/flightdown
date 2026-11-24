import {useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router';
import {useStore} from '../data/store';
import type {LatLng} from '../model/geo';
import type {Spot} from '../types';
import {formatDay, pad, toDay, today} from '../model/format';
import {
  dayVerdict,
  FAIR_GUSTS,
  FAIR_RAIN_CHANCE,
  FAIR_WIND,
  flyingDays,
  forecastUrl,
  GOOD_GUSTS,
  GOOD_RAIN_CHANCE,
  GOOD_WIND,
  hourTitle,
  readOpenMeteo,
  REFRESH_MS,
  weatherSpots,
  type DayWeather,
  type OpenMeteo,
  type Rating,
  type Reason,
} from '../model/weather';
import {Panel} from './instruments';
import {Empty, spotLabel} from './ui';
import {readJson, writeJson} from '../data/storage';

/** A forecast kept on this device: when it came, and for which point. */
interface KeptForecast {
  at: number;
  lat: number;
  lng: number;
  forecast: OpenMeteo;
}

const keptKey = (spotId: string) => `flightdown.weather.${spotId}`;

/** The forecast kept for a spot, unless there is none or it was for another point (the spot moved since). */
function readKept(spotId: string, {lat, lng}: LatLng): KeptForecast | null {
  const kept = readJson<KeptForecast>(keptKey(spotId));
  if (!kept || typeof kept.at !== 'number' || kept.lat !== lat || kept.lng !== lng) return null;
  const forecast = readOpenMeteo(kept.forecast);
  return forecast ? {...kept, forecast} : null;
}

/** Storage full or blocked: the forecast still shows, it is just not kept for next time. */
const keep = (spotId: string, kept: KeptForecast) => writeJson(keptKey(spotId), kept);

/**
 * A spot's forecast and where it stands: checking (a request is out), live (the kept one is the latest), offline or
 * failed (the request got nothing, so the kept one, if any, is older).
 */
interface Weather {
  kept: KeptForecast | null;
  /** When it was last looked at: the hours gone by are dimmed from it. */
  now: number;
  state: 'checking' | 'live' | 'offline' | 'failed';
}

/**
 * The forecast at a spot: the kept one at once, then a new one from Open-Meteo when the kept one is over 30 minutes
 * old. It looks again when the page comes back to the front or the connection comes back.
 */
function useWeather({id, lat, lng}: Spot & LatLng): Weather {
  const [weather, setWeather] = useState<Weather>(() => {
    const kept = readKept(id, {lat, lng});
    const now = Date.now();
    return {kept, now, state: kept && now - kept.at < REFRESH_MS ? 'live' : 'checking'};
  });

  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      const kept = readKept(id, {lat, lng});
      if (kept && Date.now() - kept.at < REFRESH_MS) {
        setWeather({kept, now: Date.now(), state: 'live'});
        return;
      }
      busy = true;
      setWeather({kept, now: Date.now(), state: 'checking'});
      try {
        const response = await fetch(forecastUrl({lat, lng}), {signal: controller.signal});
        const forecast = response.ok ? readOpenMeteo(await response.json()) : null;
        if (!forecast) throw new Error(`Open-Meteo answered ${response.status} with no forecast`);
        const fresh = {at: Date.now(), lat, lng, forecast};
        keep(id, fresh);
        setWeather({kept: fresh, now: fresh.at, state: 'live'});
      } catch (error) {
        if (controller.signal.aborted) return;
        // fetch fails with a TypeError when it cannot reach the server at all.
        const offline = !navigator.onLine || error instanceof TypeError;
        setWeather({kept, now: Date.now(), state: offline ? 'offline' : 'failed'});
      } finally {
        busy = false;
      }
    };
    const onFront = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    document.addEventListener('visibilitychange', onFront);
    window.addEventListener('online', refresh);
    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', onFront);
      window.removeEventListener('online', refresh);
    };
  }, [id, lat, lng]);

  return weather;
}

/** When a kept forecast came: "14:05" today, "Thu 19 Nov, 14:05" before. */
function asOf(at: number) {
  const date = new Date(at);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const day = toDay(date);
  return day === today() ? time : `${formatDay(day)}, ${time}`;
}

const RATING_WORD: Record<Rating, string> = {good: 'good', fair: 'fair', no: 'no flying'};
const REASON_WORD: Record<Reason, string> = {rain: 'rain', wind: 'too windy', gusts: 'too gusty'};

/** A day: its name and best stretch, then its daylight hours, each on the spot's shared hour scale. */
function DayRow({day, first, span}: {day: DayWeather; first: number; span: number}) {
  return (
    <div className="weather-day">
      <div className="weather-day-head">
        <span className="weather-day-name">{day.label}</span>
        <span className={`weather-verdict ${day.best ? 'good' : ''}`}>{dayVerdict(day)}</span>
      </div>
      <div className="weather-hours" style={{gridTemplateColumns: `repeat(${span}, minmax(0, 1fr))`}}>
        {day.hours.map(hour => (
          <span
            key={hour.time}
            className={`weather-hour ${hour.rating} ${hour.reason === 'rain' ? 'rain' : ''} ${hour.past ? 'past' : ''}`}
            style={{gridColumn: hour.hour - first + 1}}
            title={`${hourTitle(hour)} · ${RATING_WORD[hour.rating]}${hour.reason ? `: ${REASON_WORD[hour.reason]}` : ''}`}
          >
            {pad(hour.hour)}
          </span>
        ))}
      </div>
    </div>
  );
}

function SpotWeather({spot}: {spot: Spot & LatLng}) {
  const weather = useWeather(spot);
  const days = useMemo(
    () => (weather.kept ? flyingDays(weather.kept.forecast, weather.now) : []),
    [weather.kept, weather.now],
  );
  // One hour scale for the spot's days, so the same hour lines up from one day to the next.
  const hours = days.flatMap(day => day.hours.map(hour => hour.hour));
  const first = hours.length ? Math.min(...hours) : 0;
  const span = hours.length ? Math.max(...hours) - first + 1 : 1;
  // A forecast older than the last check: say when it came.
  const staleAt = weather.kept && weather.state !== 'live' ? weather.kept.at : null;
  const missing =
    weather.state === 'checking'
      ? 'Reading the forecast'
      : weather.state === 'failed'
        ? 'No forecast: the weather service did not answer'
        : 'No forecast: no connection';

  return (
    <div className="weather-spot">
      <div className="weather-spot-head">
        <span className="weather-spot-name">{spotLabel(spot)}</span>
        {staleAt !== null && days.length > 0 && <span className="weather-asof">as of {asOf(staleAt)}</span>}
      </div>
      {days.length ? (
        <div className="weather-days">
          {days.map(day => (
            <DayRow key={day.date} day={day} first={first} span={span} />
          ))}
        </div>
      ) : (
        <div className="weather-status">{missing}</div>
      )}
    </div>
  );
}

/**
 * Flying weather: wind, gusts and rain at the pilot's latest spot (else the most used), hour by hour through daylight
 * for 3 days, each hour rated for a small heli.
 */
export function FlyingWeather({className = ''}: {className?: string}) {
  const {doc} = useStore();
  const spots = useMemo(() => weatherSpots(doc.spots, doc.sorties), [doc.spots, doc.sorties]);

  return (
    <Panel
      label="Flying weather"
      note="Wind, gusts and rain at your latest spot, the next 3 days"
      className={`weather-panel ${className}`}
    >
      {spots.length ? (
        <>
          <div className="weather-spots">
            {spots.map(spot => (
              <SpotWeather key={spot.id} spot={spot} />
            ))}
          </div>
          <div className="gauge-legend weather-legend">
            <span
              title={`Dry (rain under ${GOOD_RAIN_CHANCE} %), wind up to ${GOOD_WIND} km/h, gusts up to ${GOOD_GUSTS}`}
            >
              <i className="weather-key good" /> good
            </span>
            <span
              title={`Wind up to ${FAIR_WIND} km/h, gusts up to ${FAIR_GUSTS}, or a shower possible (rain ${GOOD_RAIN_CHANCE} to ${FAIR_RAIN_CHANCE - 1} %)`}
            >
              <i className="weather-key fair" /> fair
            </span>
            <span
              title={`Rain forecast or likely (${FAIR_RAIN_CHANCE} % or more), or wind past ${FAIR_WIND} km/h, gusts past ${FAIR_GUSTS}`}
            >
              <i className="weather-key no" /> no flying
            </span>
            <span title="The hours rain keeps from good: forecast, likely, or a shower possible">
              <i className="weather-key no rain" /> rain
            </span>
          </div>
        </>
      ) : (
        <Empty emoji="🌬️">
          No spot has a GPS point yet. Set one on the <Link to="/spots">Spots</Link> page to see its weather here.
        </Empty>
      )}
    </Panel>
  );
}
