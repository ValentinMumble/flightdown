import {useMemo} from 'react';
import type {Sortie} from '../types';
import {useSeries} from '../data/useSeries';
import {useStore} from '../data/store';
import {personalBests} from '../model/bests';
import {formatDay, plural} from '../model/format';
import {Empty, Figure} from './ui';

/**
 * Personal bests: the longest inverted, the most flips in a pack, the longest run without a crash. Over several helis
 * (`named`), each says which heli set it.
 */
export function PersonalBests({sorties, named = false}: {sorties: Sortie[]; named?: boolean}) {
  const {heli} = useStore();
  const ids = useMemo(() => sorties.flatMap(sortie => sortie.telemetry.map(log => log.id)), [sorties]);
  const series = useSeries(ids);
  const bests = useMemo(() => (series ? personalBests(sorties, series) : null), [sorties, series]);
  if (!bests) return <div className="muted">Reading the logs…</div>;
  const {inverted, flips, cleanRun} = bests;
  if (!inverted && !flips && !cleanRun) return <Empty>No best yet: fly a few packs with their logs.</Empty>;
  const day = (date: string) => formatDay(date, {weekday: false, year: true});
  const on = (heliId: string) => (named ? `, ${heli(heliId)?.name ?? 'a heli'}` : '');
  return (
    <div className="figures bests">
      <Figure label="Longest inverted">
        {inverted ? `${inverted.seconds.toFixed(1)} s` : '–'}
        {inverted && (
          <small className="muted">
            {' '}
            {day(inverted.date)}
            {on(inverted.heliId)}
          </small>
        )}
      </Figure>
      <Figure label="Most flips in a pack">
        {flips ? flips.count : '–'}
        {flips && (
          <small className="muted">
            {' '}
            {day(flips.date)}
            {on(flips.heliId)}
          </small>
        )}
      </Figure>
      <Figure label="Longest clean run">
        {cleanRun ? plural(cleanRun.packs, 'pack') : '–'}
        {cleanRun && (
          <small className="muted">
            {' '}
            {cleanRun.from === cleanRun.to ? day(cleanRun.from) : `${day(cleanRun.from)} to ${day(cleanRun.to)}`}
          </small>
        )}
      </Figure>
    </div>
  );
}
