import {useEffect, useMemo, useState} from 'react';
import {useSearchParams} from 'react-router';
import {Activity, Plus, Search} from 'lucide-react';
import {useStore} from '../data/store';
import {Empty, HeliDot, PageHeader, Segmented, useOverlay} from '../components/ui';
import {FlightStrip} from '../components/SortieRow';
import {SortieForm} from '../components/forms/SortieForm';
import {VisitorBanner} from '../components/VisitorBanner';
import {formatAirtime, formatMonth, fromDay, plural} from '../model/format';
import {monthOf, sortSorties, totals} from '../model/stats';
import {partKey} from '../model/parts';
import {sortSpots} from '../model/geo';

type CrashFilter = 'all' | 'crashed' | 'clean';

/** Loose matching: no accents, no case. */
const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** The pickers of the filter bar, remembered in this browser so the page opens as it was left. */
const REMEMBERED = ['spot', 'heli', 'crashes', 'log'];
const FILTERS_KEY = 'flightdown.sorties.filters';
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

/** Every sortie as a flight strip, newest first, a month at a time, with filters kept in the address. */
export function Sorties() {
  const {doc, heli, spot} = useStore();
  const {open} = useOverlay();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const heliId = params.get('heli') ?? '';
  const spotId = params.get('spot') ?? '';
  const part = params.get('part') ?? '';
  const crashes = (params.get('crashes') as CrashFilter | null) ?? 'all';
  const withLog = params.get('log') === '1';

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
      log: true,
    };
    const next = new URLSearchParams(params);
    for (const key of REMEMBERED) if (saved[key] && known[key]) next.set(key, saved[key]);
    if (next.toString() !== params.toString()) setParams(next, {replace: true});
    // Only when the page opens: later changes go through setParam.
  }, []);

  const filtered = useMemo(() => {
    const words = plain(query).split(/\s+/).filter(Boolean);
    return sortSorties(doc.sorties)
      .reverse()
      .filter(sortie => {
        if (heliId && sortie.heliId !== heliId) return false;
        if (spotId && sortie.spotId !== spotId) return false;
        if (part && !sortie.broken.some(broken => partKey(broken.part) === partKey(part))) return false;
        if (crashes === 'crashed' && !sortie.crashes) return false;
        if (crashes === 'clean' && sortie.crashes !== 0) return false;
        if (withLog && !sortie.telemetry.length) return false;
        if (!words.length) return true;
        const haystack = plain(
          [
            sortie.notes,
            heli(sortie.heliId)?.name,
            spot(sortie.spotId)?.name,
            sortie.date,
            fromDay(sortie.date).toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'}),
            ...sortie.broken.map(broken => broken.part),
            ...sortie.skills,
          ].join(' '),
        );
        return words.every(word => haystack.includes(word));
      });
  }, [doc.sorties, query, heliId, spotId, part, crashes, withLog, heli, spot]);

  const months = useMemo(() => {
    const groups: {month: string; sorties: typeof filtered}[] = [];
    for (const sortie of filtered) {
      const month = monthOf(sortie.date);
      if (groups[groups.length - 1]?.month !== month) groups.push({month, sorties: []});
      groups[groups.length - 1].sorties.push(sortie);
    }
    return groups;
  }, [filtered]);

  const shown = totals(filtered);
  const helis = doc.helis.filter(one => doc.sorties.some(sortie => sortie.heliId === one.id));

  return (
    <div className="page">
      <PageHeader
        title="Sorties"
        sub="Every sortie, a flight strip each"
        actions={
          <button className="button solid desktop-only" onClick={() => open(<SortieForm />)}>
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
          <button className="chip" aria-pressed={withLog} onClick={() => setParam('log', withLog ? '' : '1')}>
            <Activity size={14} /> With log
          </button>
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
        {plural(shown.sorties, 'sortie')} · {plural(shown.packs, 'pack')} · {formatAirtime(shown.airtime, true)} ·{' '}
        {plural(shown.crashes, 'crash', 'crashes')}
      </div>

      {months.length ? (
        months.map(group => {
          const tally = totals(group.sorties);
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
                {group.sorties.map(sortie => (
                  <FlightStrip key={sortie.id} sortie={sortie} />
                ))}
              </div>
            </section>
          );
        })
      ) : (
        <div className="card">
          <Empty emoji="🔍">{doc.sorties.length ? 'No sortie matches.' : 'No sortie logged yet.'}</Empty>
        </div>
      )}
    </div>
  );
}
