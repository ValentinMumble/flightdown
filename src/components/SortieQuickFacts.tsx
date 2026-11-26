import {useMemo, useState} from 'react';
import {ChevronDown, ChevronUp, House, Pencil} from 'lucide-react';
import type {Sortie} from '../types';
import {useStore} from '../data/store';
import {sortSorties} from '../model/stats';
import {spotsByLastUse} from '../model/geo';

/** The spots shown before "more": the ones flown last, as in the sortie form. */
const SPOTS_SHOWN = 5;
/** The crash counts offered; a higher one is set in the sortie form (and shows here once set). */
const CRASH_COUNTS = [0, 1, 2, 3];

/**
 * A sortie's crashes, spot and indoors set in one tap each, saved at once: what is left to fill in once the radio's
 * logs have made a sortie. Tapping the lit chip takes it off again: the crashes back to not counted, no spot. Once a
 * spot is set, only it shows, indoors beside it, until "Change" opens the others again; indoors ends the row.
 */
export function SortieQuickFacts({sortie}: {sortie: Sortie}) {
  const {doc, patch} = useStore();
  const [everySpot, setEverySpot] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const settled = Boolean(sortie.spotId) && !choosing;
  const spots = useMemo(() => spotsByLastUse(doc.spots, sortSorties(doc.sorties)), [doc.spots, doc.sorties]);
  // The sortie's own spot always shows, even when it is not one of the last flown.
  const shown = settled
    ? spots.filter(spot => spot.id === sortie.spotId)
    : everySpot
      ? spots
      : spots.filter((spot, index) => index < SPOTS_SHOWN || spot.id === sortie.spotId);
  const counts =
    sortie.crashes !== null && !CRASH_COUNTS.includes(sortie.crashes)
      ? [...CRASH_COUNTS, sortie.crashes]
      : CRASH_COUNTS;

  const setCrashes = (count: number) => patch('sorties', sortie.id, {crashes: sortie.crashes === count ? null : count});
  const setSpot = (spotId: string) => {
    setChoosing(false);
    setEverySpot(false);
    if (sortie.spotId === spotId) patch('sorties', sortie.id, {}, ['spotId']);
    else patch('sorties', sortie.id, {spotId});
  };
  const toggleIndoor = () =>
    sortie.indoor ? patch('sorties', sortie.id, {}, ['indoor']) : patch('sorties', sortie.id, {indoor: true});
  const indoor = (
    <button type="button" className="chip" aria-pressed={Boolean(sortie.indoor)} onClick={toggleIndoor}>
      <House size={14} /> Indoor
    </button>
  );

  return (
    <div className="quick-facts">
      <div className="field">
        <span className="field-label">
          Crashes {sortie.crashes === null && <span className="muted">(not counted)</span>}
        </span>
        <div className="chips">
          {counts.map(count => (
            <button
              key={count}
              type="button"
              className="chip"
              aria-pressed={sortie.crashes === count}
              onClick={() => setCrashes(count)}
            >
              {count === 0 ? 'No crash' : `💥 ${count}`}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Spot</span>
        <div className="chips">
          {shown.map(spot => (
            <button
              key={spot.id}
              type="button"
              className="chip"
              aria-pressed={spot.id === sortie.spotId}
              onClick={() => setSpot(spot.id)}
            >
              {spot.emoji} {spot.name}
            </button>
          ))}
          {settled ? (
            <>
              {indoor}
              <button type="button" className="chip more" onClick={() => setChoosing(true)}>
                <Pencil size={13} /> Change
              </button>
            </>
          ) : (
            <>
              {spots.length > SPOTS_SHOWN && (
                <button type="button" className="chip more" onClick={() => setEverySpot(!everySpot)}>
                  {everySpot ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  {everySpot ? 'Fewer' : `${spots.length - shown.length} more`}
                </button>
              )}
              {indoor}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
