import {Link} from 'react-router';
import {Activity, Camera, Wrench} from 'lucide-react';
import type {Sortie} from '../types';
import {useStore} from '../data/store';
import {sortiePhotos, useAlbum} from '../data/album';
import {airtime} from '../model/stats';
import {formatAirtime, formatDay, formatTimer, fromDay} from '../model/format';
import {useSeriesColor} from './colors';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** Crashes as a tag: none in green, some in red, unknown in grey. */
export function CrashPill({crashes}: {crashes: number | null}) {
  if (crashes === null) return <span className="pill">💥 ?</span>;
  if (crashes === 0) return <span className="pill good">Clean</span>;
  return <span className="pill critical">💥 {crashes}</span>;
}

/**
 * A sortie as a flight strip, the paper strip air traffic controllers keep for each flight: the heli's colour on
 * the holder, then the day, the heli and spot, the packs, the airtime and how it ended.
 */
export function FlightStrip({sortie, large = false}: {sortie: Sortie; large?: boolean}) {
  const {heli, spot} = useStore();
  const color = useSeriesColor();
  const one = heli(sortie.heliId);
  const place = spot(sortie.spotId);
  const date = fromDay(sortie.date);
  const parts = sortie.broken.reduce((sum, broken) => sum + broken.qty, 0);
  const shots = sortiePhotos(sortie, useAlbum()).length;
  return (
    <Link
      to={`/sorties/${sortie.id}`}
      className={`flight-strip ${large ? 'large' : ''}`}
      style={{['--strip' as string]: color(one?.color ?? -1)}}
    >
      <span className="strip-date" title={formatDay(sortie.date, {year: true})}>
        <span>{WEEKDAYS[date.getDay()]}</span>
        <b>{String(date.getDate()).padStart(2, '0')}</b>
        <span>
          {MONTHS[date.getMonth()]} {date.getFullYear()}
        </span>
      </span>
      <span className="strip-main">
        <span className="strip-heli">{one?.name ?? 'Unknown heli'}</span>
        <span className="strip-spot">
          {place ? `${place.emoji ? `${place.emoji} ` : ''}${place.name}` : 'Somewhere'}
          {sortie.notes && <span className="strip-notes"> · {sortie.notes}</span>}
        </span>
      </span>
      <span className="strip-cell strip-packs">
        <small>Packs</small>
        <b>
          {sortie.packs}×{formatTimer(sortie.timer)}
        </b>
      </span>
      <span className="strip-cell strip-time">
        <small>Air</small>
        <b>{formatAirtime(airtime(sortie))}</b>
      </span>
      <span className="strip-cell strip-end">
        <CrashPill crashes={sortie.crashes} />
        <span className="strip-icons">
          {parts > 0 && (
            <span className="pill caution" title={`${parts} broken parts`}>
              <Wrench size={12} /> {parts}
            </span>
          )}
          {shots > 0 && (
            <span className="pill label" title={`${shots} photos`}>
              <Camera size={12} /> {shots}
            </span>
          )}
          {sortie.telemetry.length > 0 && (
            <span className="pill label" title="Telemetry">
              <Activity size={12} /> Log
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}
