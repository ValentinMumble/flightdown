import {useMemo} from 'react';
import {Link} from 'react-router';
import type {Sortie} from '../../types';
import {useStore} from '../../data/store';
import {HeliName} from '../ui';
import {costs} from '../../model/costs';
import {formatAirtime, formatPrice, plural} from '../../model/format';

/** Whole euros: the figures are rough, cents add nothing. */
const euros = (value: number) => formatPrice(Math.round(value));

/**
 * What the flying cost: the helis and gear bought in the period (`all`, or a year), the parts its crashes broke, and
 * each heli flown in it, an hour in the air over its whole life. With one heli picked (`heliId`), that heli alone.
 */
export function Costs({sorties, period, heliId}: {sorties: Sortie[]; period: string; heliId: string}) {
  const {doc} = useStore();
  const inPeriod = (day: string | undefined) => period === 'all' || !!day?.startsWith(period);
  const bought = doc.helis.filter(heli => (!heliId || heli.id === heliId) && inPeriod(heli.acquired));
  const gear = heliId ? [] : doc.gear.filter(piece => inPeriod(piece.since));
  const spent = (items: {price?: number}[]) => items.reduce((sum, item) => sum + (item.price ?? 0), 0);
  const priced = (items: {price?: number}[]) => items.filter(item => item.price !== undefined).length;

  const money = useMemo(() => costs(sorties, doc.helis, doc.spares), [sorties, doc.helis, doc.spares]);
  const lives = useMemo(() => {
    const flown = new Set(sorties.map(sortie => sortie.heliId));
    return costs(
      doc.sorties.filter(sortie => flown.has(sortie.heliId)),
      doc.helis,
      doc.spares,
    ).byHeli;
  }, [sorties, doc.sorties, doc.helis, doc.spares]);
  const missing = money.unpriced.slice(0, 4);

  return (
    <>
      <div className="figures">
        <div>
          <div className="figure-label">{heliId ? 'Bought' : 'Helis bought'}</div>
          <div className="figure-value">{euros(spent(bought))}</div>
          <div className="figure-note">
            {priced(bought)} of {plural(bought.length, 'heli')} priced
          </div>
        </div>
        {!heliId && (
          <div>
            <div className="figure-label">Gear bought</div>
            <div className="figure-value">{euros(spent(gear))}</div>
            <div className="figure-note">
              {priced(gear)} of {gear.length} priced
            </div>
          </div>
        )}
        <div>
          <div className="figure-label">Crash parts</div>
          <div className="figure-value">{euros(money.partsCost)}</div>
          <div className="figure-note">
            {money.pricedParts} of {plural(money.parts, 'part')} priced
          </div>
        </div>
      </div>
      <div className="heli-table">
        <div className="heli-table-row head">
          <span>Heli</span>
          <span>Air</span>
          <span>Price</span>
          <span>An hour</span>
        </div>
        {lives.map(({heli, airtime, perHour}) => (
          <Link key={heli.id} to={`/helis/${heli.id}`} className="heli-table-row">
            <span className="name">
              <HeliName heli={heli} />
            </span>
            <span className="tabular">{formatAirtime(airtime)}</span>
            <span className="muted tabular">{heli.price !== undefined ? euros(heli.price) : '?'}</span>
            <span className="tabular">{perHour !== null ? euros(perHour) : '?'}</span>
          </Link>
        ))}
      </div>
      <p className="caption">
        An hour: a heli's price and its priced crash parts over its whole time in the air.
        {missing.length > 0 &&
          ` No price yet for ${missing.map(part => `${part.name} (${part.qty})`).join(', ')}: a spare with a price counts them.`}
      </p>
    </>
  );
}
