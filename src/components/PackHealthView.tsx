import {useMemo} from 'react';
import type {Heli} from '../types';
import {useStore} from '../data/store';
import {HeliName} from './ui';
import {Panel} from './instruments';
import {PackHealth} from './charts/PackHealth';
import {PackOverTime, type PackMeasure} from './charts/PackResistance';

/** The charts over time, in the order shown. */
const CHARTS: {measure: PackMeasure; label: string; note: string; span: string}[] = [
  {
    measure: 'resistance',
    label: 'Resistance',
    note: "A cell's share, how far its volts fall an amp over each flight: it climbs as a pack ages, twice its first is worn",
    span: 'span-12',
  },
  {
    measure: 'mah',
    label: 'mAh a flight',
    note: 'What each flight took from the pack: a tired pack gives less',
    span: 'span-6',
  },
  {
    measure: 'low',
    label: 'Lowest cell under load',
    note: 'The lowest a cell sagged in each flight: a tired pack sags lower',
    span: 'span-6',
  },
];

/** A heli's packs: the table of where each stands, then a chart a measure, from its sorties only. */
function HeliPacks({heli}: {heli: Heli}) {
  const {doc} = useStore();
  const sorties = useMemo(() => doc.sorties.filter(sortie => sortie.heliId === heli.id), [doc.sorties, heli.id]);
  return (
    <>
      <h3 className="section-title section-head">
        <HeliName heli={heli} />
      </h3>
      <div className="bento">
        <Panel
          className="span-12"
          label="Each pack"
          note="Its resistance from its first flight to its latest, its trend, and the flights left before it is worn at that rate"
        >
          <PackHealth sorties={sorties} />
        </Panel>
        {CHARTS.map(chart => (
          <Panel key={chart.measure} className={chart.span} label={chart.label} note={chart.note}>
            <PackOverTime sorties={sorties} measure={chart.measure} />
          </Panel>
        ))}
      </div>
    </>
  );
}

/** A heli no longer flying: sold, lost or retired. */
const gone = (heli: Heli) => heli.status !== 'active' && heli.status !== 'grounded';

/** Every pack's health over time, heli by heli: those with logged sorties, the ones flying first. */
export default function PackHealthView() {
  const {doc} = useStore();
  const helis = useMemo(
    () =>
      doc.helis
        .filter(heli => doc.sorties.some(sortie => sortie.heliId === heli.id && sortie.telemetry.length))
        .sort((left, right) => Number(gone(left)) - Number(gone(right))),
    [doc.helis, doc.sorties],
  );
  if (!helis.length) return null;
  return (
    <>
      <h2 className="section-title section-head">Pack health</h2>
      {helis.map(heli => (
        <HeliPacks key={heli.id} heli={heli} />
      ))}
    </>
  );
}
