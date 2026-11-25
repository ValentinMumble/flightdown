import {useMemo} from 'react';
import type {Sortie} from '../types';
import {useSeries} from '../data/useSeries';
import {useStore} from '../data/store';
import {personalBests, type Best, type BestKind} from '../model/bests';
import {formatAirtime, formatDay, formatTimer, plural} from '../model/format';
import {Empty, Figure} from './ui';

/** Each best: its name, and its value in words. */
const SHOWN: Record<BestKind, {label: string; value: (value: number) => string}> = {
  packTime: {label: 'Longest pack', value: value => formatTimer(Math.round(value))},
  inverted: {label: 'Longest inverted', value: value => `${value.toFixed(1)} s`},
  packInverted: {label: 'Most inverted in a pack', value: value => `${Math.round(value)} s`},
  flips: {label: 'Most flips in a pack', value: value => String(value)},
  flipChain: {label: 'Longest flip chain', value: value => plural(value, 'flip')},
  amps: {label: 'Most current', value: value => `${Math.round(value)} A`},
  dayAirtime: {label: 'Most airtime in a day', value: value => formatAirtime(value)},
  dayPacks: {label: 'Most packs in a day', value: value => String(value)},
  cleanRun: {label: 'Longest clean run', value: value => plural(value, 'pack')},
  flyingDays: {label: 'Flying days in a row', value: value => String(value)},
};

/**
 * Personal bests: in a pack, in a day and in a row (see bests.ts). Over several helis (`named`), a best in a pack says
 * which heli set it.
 */
export function PersonalBests({sorties, named = false}: {sorties: Sortie[]; named?: boolean}) {
  const {heli} = useStore();
  const ids = useMemo(() => sorties.flatMap(sortie => sortie.telemetry.map(log => log.id)), [sorties]);
  const series = useSeries(ids);
  const bests = useMemo(() => (series ? personalBests(sorties, series) : null), [sorties, series]);
  if (!bests) return <div className="muted">Reading the logs…</div>;
  if (!bests.length) return <Empty>No best yet: fly a few packs with their logs.</Empty>;
  const day = (date: string) => formatDay(date, {weekday: false, year: true});
  const when = (best: Best) =>
    `${best.to && best.to !== best.date ? `${day(best.date)} to ${day(best.to)}` : day(best.date)}${
      named && best.heliId ? `, ${heli(best.heliId)?.name ?? 'a heli'}` : ''
    }`;
  return (
    <div className="figures bests">
      {bests.map(best => (
        <Figure key={best.kind} label={SHOWN[best.kind].label}>
          {SHOWN[best.kind].value(best.value)}
          <small className="muted"> {when(best)}</small>
        </Figure>
      ))}
    </div>
  );
}
