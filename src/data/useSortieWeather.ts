import {useEffect, useRef} from 'react';
import {useStore} from './store';
import {fetchSortieWeather, weatherSpotFor} from '../model/pastWeather';
import {radioClockAhead} from '../model/session';

/** Open-Meteo is asked this many at a time, so a long log's first fill takes seconds, not minutes. */
const AT_ONCE = 4;

/**
 * Fills in the weather of the sorties that need it (outdoors, at a located spot, flown in hours that are past), in the
 * background: on the owner's log and a visitor's own, not the sample. A sortie Open-Meteo has nothing for is asked
 * again only on the next visit. Only the weather is written, onto the sortie as the server has it.
 */
export function useSortieWeather() {
  const {mode, doc, patch} = useStore();
  const latest = useRef(doc);
  latest.current = doc;
  const busy = useRef(false);
  const tried = useRef(new Set<string>());

  useEffect(() => {
    if ((mode !== 'owner' && mode !== 'local') || busy.current || !navigator.onLine) return;
    const spots = new Map(doc.spots.map(spot => [spot.id, spot]));
    const ahead = radioClockAhead(doc.gear);
    const todo = doc.sorties.filter(
      sortie =>
        !tried.current.has(sortie.id) && weatherSpotFor(sortie, spots.get(sortie.spotId ?? ''), undefined, ahead),
    );
    if (!todo.length) return;
    busy.current = true;
    const run = async () => {
      const queue = [...todo];
      const work = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          tried.current.add(next.id);
          const spot = weatherSpotFor(next, spots.get(next.spotId ?? ''), undefined, ahead);
          const weather = spot ? await fetchSortieWeather(next, spot, ahead).catch(() => null) : null;
          const now = latest.current.sorties.find(sortie => sortie.id === next.id);
          // Written only while the sortie is still at that spot: one moved since is read again on the next pass.
          if (weather && now) {
            if (now.spotId === weather.spotId) patch('sorties', now.id, {weather});
            tried.current.delete(next.id);
          }
        }
      };
      await Promise.all(Array.from({length: AT_ONCE}, work));
      busy.current = false;
    };
    void run();
  }, [mode, doc, patch]);
}
