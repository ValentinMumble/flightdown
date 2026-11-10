import {useEffect, useMemo, useState} from 'react';
import {useSearchParams} from 'react-router';
import {Plus, Search} from 'lucide-react';
import {useStore} from '../data/store';
import {Empty, HeliDot, PageHeader, Segmented, useOverlay} from '../components/ui';
import {FlightStrip} from '../components/SessionRow';
import {SessionForm} from '../components/forms/SessionForm';
import {VisitorBanner} from '../components/VisitorBanner';
import {formatAirtime, formatMonth, fromDay, plural} from '../model/format';
import {monthOf, sortSessions, totals} from '../model/stats';
import {partKey} from '../model/parts';
import {sortSpots} from '../model/geo';

type CrashFilter = 'all' | 'crashed' | 'clean';

/** Loose matching: no accents, no case. */
const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** The pickers of the filter bar, remembered in this browser so the logbook opens as it was left. */
const REMEMBERED = ['spot', 'heli', 'crashes'];
const FILTERS_KEY = 'flightdown.logbook.filters';
/** Any of these in the address: the page was opened on purpose with its own filter, which wins. */
const FILTERS = [...REMEMBERED, 'part', 'q'];

function readRemembered(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(FILTERS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function remember(params: URLSearchParams) {
  const kept = REMEMBERED.filter(key => params.get(key)).map(key => [key, params.get(key) ?? '']);
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Private browsing or storage turned off: the filters just are not remembered.
  }
}

/** The logbook: every session as a flight strip, newest first, a month at a time, with filters kept in the address. */
export function Sessions() {
  const {doc, heli, spot} = useStore();
  const {open} = useOverlay();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const heliId = params.get('heli') ?? '';
  const spotId = params.get('spot') ?? '';
  const part = params.get('part') ?? '';
  const crashes = (params.get('crashes') as CrashFilter | null) ?? 'all';

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    setParams(next, {replace: true});
    if (REMEMBERED.includes(key)) remember(next);
  };

  // Opened with no filter in the address: the filters of last time, while their spot and heli still exist.
  useEffect(() => {
    if (FILTERS.some(key => params.has(key))) return;
    const saved = readRemembered();
    const known: Record<string, boolean> = {
      spot: !saved.spot || doc.spots.some(one => one.id === saved.spot),
      heli: !saved.heli || doc.helis.some(one => one.id === saved.heli),
      crashes: ['crashed', 'clean'].includes(saved.crashes ?? 'crashed'),
    };
    const next = new URLSearchParams(params);
    for (const key of REMEMBERED) if (saved[key] && known[key]) next.set(key, saved[key]);
    if (next.toString() !== params.toString()) setParams(next, {replace: true});
    // Only when the page opens: later changes go through setParam.
  }, []);

  const filtered = useMemo(() => {
    const words = plain(query).split(/\s+/).filter(Boolean);
    return sortSessions(doc.sessions)
      .reverse()
      .filter(session => {
        if (heliId && session.heliId !== heliId) return false;
        if (spotId && session.spotId !== spotId) return false;
        if (part && !session.broken.some(broken => partKey(broken.part) === partKey(part))) return false;
        if (crashes === 'crashed' && !session.crashes) return false;
        if (crashes === 'clean' && session.crashes !== 0) return false;
        if (!words.length) return true;
        const haystack = plain(
          [
            session.notes,
            heli(session.heliId)?.name,
            spot(session.spotId)?.name,
            session.date,
            fromDay(session.date).toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'}),
            ...session.broken.map(broken => broken.part),
            ...session.skills,
          ].join(' '),
        );
        return words.every(word => haystack.includes(word));
      });
  }, [doc.sessions, query, heliId, spotId, part, crashes, heli, spot]);

  const months = useMemo(() => {
    const groups: {month: string; sessions: typeof filtered}[] = [];
    for (const session of filtered) {
      const month = monthOf(session.date);
      if (groups[groups.length - 1]?.month !== month) groups.push({month, sessions: []});
      groups[groups.length - 1].sessions.push(session);
    }
    return groups;
  }, [filtered]);

  const shown = totals(filtered);
  const helis = doc.helis.filter(one => doc.sessions.some(session => session.heliId === one.id));

  return (
    <div className="page">
      <PageHeader
        title="Logbook"
        sub="Every sortie, a flight strip each"
        actions={
          <button className="button solid desktop-only" onClick={() => open(<SessionForm />)}>
            <Plus size={16} strokeWidth={2.4} /> Log
          </button>
        }
      />
      <VisitorBanner />

      <div className="filters">
        <div className="toolbar">
          <label className="search">
            <Search size={16} />
            <input
              className="input"
              type="search"
              placeholder="Search notes, parts, places, days"
              value={query}
              onChange={event => {
                setQuery(event.target.value);
                setParam('q', event.target.value);
              }}
            />
          </label>
          <select className="input" value={spotId} onChange={event => setParam('spot', event.target.value)}>
            <option value="">Every spot</option>
            {sortSpots(doc.spots).map(one => (
              <option key={one.id} value={one.id}>
                {one.emoji} {one.name}
              </option>
            ))}
          </select>
          <Segmented<CrashFilter>
            label="Crashes"
            value={crashes}
            onChange={value => setParam('crashes', value)}
            options={[
              {value: 'all', label: 'All'},
              {value: 'crashed', label: 'Crashed'},
              {value: 'clean', label: 'Clean'},
            ]}
          />
        </div>
        <div className="chips scroll">
          <button className="chip" aria-pressed={!heliId} onClick={() => setParam('heli', '')}>
            Every heli
          </button>
          {helis.map(one => (
            <button
              key={one.id}
              className="chip"
              aria-pressed={one.id === heliId}
              onClick={() => setParam('heli', one.id === heliId ? '' : one.id)}
            >
              <HeliDot heli={one} /> {one.name}
            </button>
          ))}
          {part && (
            <button className="chip" aria-pressed onClick={() => setParam('part', '')}>
              Broke: {part} ✕
            </button>
          )}
        </div>
      </div>

      <div className="summary-line">
        {plural(shown.sessions, 'session')} · {plural(shown.packs, 'pack')} · {formatAirtime(shown.airtime, true)} ·{' '}
        {plural(shown.crashes, 'crash', 'crashes')}
      </div>

      {months.length ? (
        months.map(group => {
          const tally = totals(group.sessions);
          return (
            <section key={group.month} className="log-month">
              <div className="month-head">
                <h3>{formatMonth(group.month, true)}</h3>
                <span>
                  {formatAirtime(tally.airtime)} · {plural(tally.packs, 'pack')} ·{' '}
                  {plural(tally.crashes, 'crash', 'crashes')}
                </span>
              </div>
              <div className="strip-board">
                {group.sessions.map(session => (
                  <FlightStrip key={session.id} session={session} />
                ))}
              </div>
            </section>
          );
        })
      ) : (
        <div className="card">
          <Empty emoji="🔍">{doc.sessions.length ? 'No session matches.' : 'No session logged yet.'}</Empty>
        </div>
      )}
    </div>
  );
}
