import {useMemo} from 'react';
import type {Sortie} from '../../types';
import {useStore} from '../../data/store';
import {packRecords} from '../../model/packs';
import {packHealth} from '../../model/cockpit';
import {formatNumber} from '../../model/format';

/**
 * Each pack's health, as a helicopter's health and usage monitoring tracks a part: its resistance (a cell's share)
 * from its first reading to its latest, the trend a flight, the flights left before it is twice its first at that
 * trend, the mAh it gives a flight and its lowest cell under load. The live packs first, the dead ones under them.
 */
export function PackHealth({sorties}: {sorties: Sortie[]}) {
  const {doc} = useStore();
  const rows = useMemo(
    () =>
      packRecords(sorties, doc.batteries)
        .filter(record => record.flights > 0)
        .map(packHealth)
        .sort(
          (left, right) =>
            Number(Boolean(left.record.pack.dead)) - Number(Boolean(right.record.pack.dead)) ||
            left.record.label.localeCompare(right.record.label),
        ),
    [sorties, doc.batteries],
  );
  if (!rows.length)
    return <div className="muted">No pack flown with its button pressed yet: give packs buttons in the Hangar.</div>;

  return (
    <div className="health-table">
      <div className="health-row head">
        <span>Pack</span>
        <span>Resistance</span>
        <span>A flight</span>
        <span>Worn in</span>
        <span>mAh</span>
        <span>Lowest</span>
      </div>
      {rows.map(({record, trend, flightsLeft, mah, low}) => {
        const change = record.first && record.latest ? record.latest / record.first : null;
        return (
          <div
            key={`${record.battery.id}#${record.pack.number}`}
            className={`health-row ${record.pack.dead ? 'dead' : ''}`}
          >
            <span className="name">
              <span className="name-main">{record.label}</span>
              <small className="name-note">
                {record.pack.dead ? 'dead' : `${record.flights} ${record.flights === 1 ? 'flight' : 'flights'}`}
              </small>
            </span>
            <span>
              {record.first !== undefined && record.latest !== undefined
                ? `${formatNumber(record.first, 0)} → ${formatNumber(record.latest, 0)} mΩ`
                : '–'}
              {change !== null && change >= 1.5 && (
                <small className={change >= 2 ? 'warning' : 'caution'}> ×{formatNumber(change, 1)}</small>
              )}
            </span>
            <span>{trend !== null ? `${trend >= 0 ? '+' : ''}${formatNumber(trend, 1)}` : '–'}</span>
            <span>
              {record.pack.dead
                ? '–'
                : flightsLeft === null
                  ? trend === null
                    ? 'too few'
                    : 'steady'
                  : `~${flightsLeft} ${flightsLeft === 1 ? 'flight' : 'flights'}`}
            </span>
            <span>{mah !== null ? formatNumber(mah) : '–'}</span>
            <span>{low !== null ? `${formatNumber(low, 2)} V` : '–'}</span>
          </div>
        );
      })}
    </div>
  );
}
