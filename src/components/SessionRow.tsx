import {Link} from 'react-router';
import {Activity, Wrench} from 'lucide-react';
import type {Session} from '../types';
import {useStore} from '../data/store';
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
 * A session as a flight strip, the paper strip air traffic controllers keep for each flight: the heli's colour on
 * the holder, then the day, the heli and spot, the packs, the airtime and how it ended.
 */
export function FlightStrip({session, large = false}: {session: Session; large?: boolean}) {
  const {heli, spot} = useStore();
  const color = useSeriesColor();
  const one = heli(session.heliId);
  const place = spot(session.spotId);
  const date = fromDay(session.date);
  const parts = session.broken.reduce((sum, broken) => sum + broken.qty, 0);
  return (
    <Link
      to={`/sessions/${session.id}`}
      className={`flight-strip ${large ? 'large' : ''}`}
      style={{['--strip' as string]: color(one?.color ?? -1)}}
    >
      <span className="strip-date" title={formatDay(session.date, {year: true})}>
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
          {session.notes && <span className="strip-notes"> · {session.notes}</span>}
        </span>
      </span>
      <span className="strip-cell strip-packs">
        <small>Packs</small>
        <b>
          {session.packs}×{formatTimer(session.timer)}
        </b>
      </span>
      <span className="strip-cell strip-time">
        <small>Air</small>
        <b>{formatAirtime(airtime(session))}</b>
      </span>
      <span className="strip-cell strip-end">
        <CrashPill crashes={session.crashes} />
        <span className="strip-icons">
          {parts > 0 && (
            <span className="pill caution" title={`${parts} broken parts`}>
              <Wrench size={12} /> {parts}
            </span>
          )}
          {session.telemetry.length > 0 && (
            <span className="pill label" title="Telemetry">
              <Activity size={12} /> Log
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}
