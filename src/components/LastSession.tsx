import {useMemo} from 'react';
import {Link} from 'react-router';
import {ChevronRight} from 'lucide-react';
import {useStore} from '../data/store';
import {useSeries} from '../data/useSeries';
import {Empty, Figure} from './ui';
import {InvertedMark, Panel} from './instruments';
import {packDebrief} from '../model/cockpit';
import {joinSeries, packRecords, sortiePacks} from '../model/packs';
import {clockAt, lastSession, packEvents, type SessionEvent} from '../model/session';
import {modelFromFileName} from '../model/telemetry';
import {ago, formatAirtime, formatDay} from '../model/format';
import {sortSorties} from '../model/stats';
import {switchRole} from '../radio/roles';
import type {TelemetrySeries} from '../types';

/**
 * The latest session with radio logs, at a glance: its packs (time in the air, share used, upside down) with what
 * their logs say of each (too deep, a cell sagging, over the rating, flown hard, tiring), then what happened in flight
 * by the samples: a throttle hold flipped under load, the link lost, a hard stop.
 */
export function LastSession({className = ''}: {className?: string}) {
  const {doc} = useStore();
  const session = useMemo(() => lastSession(sortSorties(doc.sorties)), [doc.sorties]);
  const packs = useMemo(() => (session ? sortiePacks(session) : []), [session]);
  const notes = useMemo(
    () => (session ? packDebrief(session, doc.batteries, packRecords(doc.sorties, doc.batteries)) : []),
    [session, doc.batteries, doc.sorties],
  );
  // The samples are read for the events only, after the rest shows.
  const ids = useMemo(() => packs.flatMap(pack => pack.files.map(file => file.id)), [packs]);
  const loaded = useSeries(ids);
  const events = useMemo(() => {
    const found: {pack: string; clock: string; event: SessionEvent}[] = [];
    if (!session || !loaded) return found;
    const model = modelFromFileName(session.telemetry[0]?.name ?? '') ?? undefined;
    const running = switchRole(model, 'SF')?.running ?? 'up';
    for (const [index, pack] of packs.entries()) {
      const parts = pack.files.map(file => loaded.get(file.id));
      if (parts.some(part => !part)) continue;
      const series = joinSeries(pack, parts as TelemetrySeries[]);
      for (const event of packEvents(series, running)) {
        found.push({pack: notes[index]?.name ?? `Pack ${index + 1}`, clock: clockAt(pack.start, event.at), event});
      }
    }
    return found;
  }, [session, packs, notes, loaded]);

  const heli = doc.helis.find(one => one.id === session?.heliId);
  const spot = doc.spots.find(one => one.id === session?.spotId);
  const flying = packs.reduce(
    (sum, pack) => sum + pack.files.reduce((total, file) => total + (file.flying ?? 0), 0),
    0,
  );
  const inverted = packs.reduce(
    (sum, pack) => sum + pack.files.reduce((total, file) => total + (file.inverted ?? 0), 0),
    0,
  );

  return (
    <Panel
      label="Last session"
      note={
        session
          ? `${ago(session.date)[0].toUpperCase()}${ago(session.date).slice(1)}, ${formatDay(session.date, {weekday: false})}${heli ? ` · ${heli.name}` : ''}${spot ? ` · ${spot.name}` : ''}`
          : undefined
      }
      className={className}
      action={
        session && (
          <Link to={`/sorties/${session.id}`} className="button small ghost">
            Sortie <ChevronRight size={14} />
          </Link>
        )
      }
    >
      {!session ? (
        <Empty>No session with radio logs yet: bring them in with `npm run logs`.</Empty>
      ) : (
        <div className="session">
          <div className="figures">
            <Figure label="Packs">{packs.length}</Figure>
            <Figure label="In the air">{formatAirtime(flying)}</Figure>
            <div>
              <div className="figure-label">Inverted</div>
              <div className="figure-value figure-picto">
                <InvertedMark size={20} />
                {inverted >= 60 ? formatAirtime(inverted) : `${inverted} s`}
              </div>
            </div>
          </div>
          <div className="pack-debrief">
            {notes.map((pack, index) => {
              const flown = packs[index];
              const seconds = flown?.files.reduce((total, file) => total + (file.flying ?? 0), 0) ?? 0;
              return (
                <div key={`${pack.name}-${index}`} className="pack-debrief-row">
                  <span className="pack-debrief-name">
                    {pack.name}
                    <small className="session-pack-time">{formatAirtime(seconds)}</small>
                  </span>
                  <span className="pack-debrief-notes">
                    {pack.notes.map(note => (
                      <span key={note.text} className={`pill ${note.tone === 'warning' ? 'critical' : note.tone}`}>
                        {note.text}
                      </span>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
          {events.length > 0 && (
            <ul className="session-events">
              {events.map(({pack, clock, event}) => (
                <li key={`${pack}-${event.at}-${event.text}`} className={event.tone}>
                  <span className="session-event-clock">{clock}</span> {pack}: {event.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}
