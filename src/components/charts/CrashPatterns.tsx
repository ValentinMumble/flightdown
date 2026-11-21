import {useMemo} from 'react';
import type {Sortie} from '../../types';
import {BarList} from './BarList';
import {formatRate, plural} from '../../model/format';
import {crashPatterns, GAPS, packsPerCrash, type Tally} from '../../model/patterns';
import {crashesByWind} from '../../model/pastWeather';
import {RAMP_DARK} from '../../model/palette';

/** One bar: packs flown for each crash (higher is better), and how many sorties say it. */
const bar = (key: string, label: string, tally: Pick<Tally, 'sorties' | 'packs' | 'crashes'>) => ({
  key,
  label,
  value: tally.sorties ? packsPerCrash(tally) : 0,
  display: tally.sorties ? (
    <>
      {formatRate(packsPerCrash(tally))} <small className="muted">· {plural(tally.sorties, 'sortie')}</small>
    </>
  ) : (
    <small className="muted">no sortie</small>
  ),
});

/** The crashes set against what came before them: a crash the sortie before, indoors or not, the days since. */
export function CrashPatterns({sorties}: {sorties: Sortie[]}) {
  const patterns = useMemo(() => crashPatterns(sorties), [sorties]);
  if (patterns.all.sorties < 2) return <div className="muted">Too few sorties in this period to compare.</div>;
  return (
    <div className="stack" style={{gap: 14}}>
      <div>
        <div className="figure-label">The sortie before</div>
        <BarList
          items={[
            bar('after-crash', 'After a sortie with a crash', patterns.afterCrash),
            bar('after-clean', 'After one without', patterns.afterClean),
          ]}
        />
      </div>
      <div>
        <div className="figure-label">Where</div>
        <BarList items={[bar('outdoor', 'Outdoors', patterns.outdoor), bar('indoor', 'Indoors', patterns.indoor)]} />
      </div>
      <div>
        <div className="figure-label">Days since the sortie before</div>
        <BarList items={GAPS.map((band, index) => bar(band.label, band.label, patterns.gaps[index]))} />
      </div>
      <p className="caption">
        Packs flown for each crash: longer is better. Busy stretches are often when something new is being learnt, so
        this says when the crashes came, not why.
      </p>
    </div>
  );
}

/** The outdoor sorties by the wind they flew in, from the weather at their spot. */
export function WindCrashes({sorties}: {sorties: Sortie[]}) {
  const bands = useMemo(() => crashesByWind(sorties), [sorties]);
  const counted = bands.reduce((sum, band) => sum + band.sorties, 0);
  if (!counted) {
    return <div className="muted">No outdoor sortie with its weather yet: it is filled in for spots on the map.</div>;
  }
  return (
    <>
      {/* The weather's blue, as the forecast's. */}
      <BarList color={RAMP_DARK[3]} items={bands.map(band => bar(band.label, band.label, band))} />
      <p className="caption">
        Packs flown for each crash, by the mean wind at the spot over the hours flown (Open-Meteo), from{' '}
        {plural(counted, 'outdoor sortie')}.
      </p>
    </>
  );
}
