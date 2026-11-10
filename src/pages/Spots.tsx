import {useMemo, useState} from 'react';
import {ChevronDown, ChevronUp, MapPin, Plus} from 'lucide-react';
import type {Spot} from '../types';
import {useStore} from '../data/store';
import {Empty, PageHeader, useOverlay} from '../components/ui';
import {Panel} from '../components/instruments';
import {VisitorBanner} from '../components/VisitorBanner';
import {SpotForm} from '../components/forms/HangarForms';
import {SpotsMap} from '../components/LazyMaps';
import {groupBy, type GroupTally} from '../model/stats';
import {hasLocation} from '../model/geo';
import {formatAirtime, formatDay, plural} from '../model/format';

type SortKey = 'name' | 'sessions' | 'airtime' | 'last';

/** The table's columns: what each sorts by, and how the order reads each way (the natural one first). */
const COLUMNS: {key: SortKey; label: string; natural: 'ascending' | 'descending'; notes: [string, string]}[] = [
  {key: 'name', label: 'Spot', natural: 'ascending', notes: ['A to Z', 'Z to A']},
  {key: 'sessions', label: 'Sorties', natural: 'descending', notes: ['Most sorties first', 'Fewest sorties first']},
  {key: 'airtime', label: 'Air', natural: 'descending', notes: ['Most airtime first', 'Least airtime first']},
  {key: 'last', label: 'Last flown', natural: 'descending', notes: ['Latest flown first', 'Longest ago first']},
];

/** Where the pilot flies: every spot on a satellite map, and a row each with what was flown there. */
export function Spots() {
  const {doc} = useStore();
  const {open} = useOverlay();
  const tallies = useMemo(
    () => new Map(groupBy(doc.sessions, session => session.spotId).map(tally => [tally.key, tally])),
    [doc.sessions],
  );
  const counts = useMemo(() => new Map([...tallies.values()].map(tally => [tally.key, tally.sessions])), [tallies]);
  const [sort, setSort] = useState<{key: SortKey; flipped: boolean}>({key: 'sessions', flipped: false});
  const column = COLUMNS.find(one => one.key === sort.key) ?? COLUMNS[0];
  const direction = (column.natural === 'ascending') !== sort.flipped ? 1 : -1;
  const spots = useMemo(() => {
    const value = (spot: Spot) => {
      const tally = tallies.get(spot.id);
      if (sort.key === 'name') return spot.name;
      if (sort.key === 'last') return tally?.last ?? '';
      return tally?.[sort.key] ?? 0;
    };
    return [...doc.spots].sort((left, right) => {
      const first = value(left);
      const second = value(right);
      const order =
        typeof first === 'number' && typeof second === 'number'
          ? first - second
          : String(first).localeCompare(String(second));
      return order * direction || left.name.localeCompare(right.name);
    });
  }, [doc.spots, tallies, sort.key, direction]);
  const sortBy = (key: SortKey) =>
    setSort(current => (current.key === key ? {key, flipped: !current.flipped} : {key, flipped: false}));
  const placed = spots.filter(hasLocation);
  const edit = (spot?: Spot) => open(<SpotForm spot={spot} />);

  return (
    <div className="page">
      <PageHeader
        title="Spots"
        sub="Where you fly"
        actions={
          <button className="button solid" onClick={() => edit()}>
            <Plus size={16} strokeWidth={2.4} /> Spot
          </button>
        }
      />
      <VisitorBanner />

      <div className="bento">
        <Panel
          label="From above"
          note={`${placed.length} of ${plural(spots.length, 'spot')} placed: tap a pin to open it`}
          className="span-12"
        >
          {placed.length > 0 ? (
            <SpotsMap spots={spots} sessions={counts} onSelect={edit} />
          ) : (
            <Empty emoji="📍">No spot has a location yet. Open one below and tap the map where you fly.</Empty>
          )}
        </Panel>

        <Panel label="Every spot" note={column.notes[sort.flipped ? 1 : 0]} className="span-12">
          <div className="spot-table spots-list">
            <div className="spot-row head">
              {COLUMNS.map(one => {
                const active = one.key === sort.key;
                const shown = active ? (direction === 1 ? 'ascending' : 'descending') : 'none';
                return (
                  <span key={one.key} role="columnheader" aria-sort={shown}>
                    <button className={`sort-head ${active ? 'active' : ''}`} onClick={() => sortBy(one.key)}>
                      {one.label}
                      {active && (direction === 1 ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                    </button>
                  </span>
                );
              })}
            </div>
            {spots.map(spot => (
              <SpotRow key={spot.id} spot={spot} tally={tallies.get(spot.id)} onOpen={() => edit(spot)} />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function SpotRow({spot, tally, onOpen}: {spot: Spot; tally?: GroupTally; onOpen: () => void}) {
  return (
    <button className="spot-row" onClick={onOpen}>
      <span className="name">
        <MapPin size={14} className={hasLocation(spot) ? 'placed' : 'unplaced'} aria-hidden />
        {spot.emoji && `${spot.emoji} `}
        {spot.name}
        {!hasLocation(spot) && <small className="muted"> · not placed</small>}
      </span>
      <span>{tally?.sessions ?? 0}</span>
      <span>{tally ? formatAirtime(tally.airtime) : '–'}</span>
      <span>{tally ? formatDay(tally.last, {weekday: false, year: true}) : '–'}</span>
    </button>
  );
}
