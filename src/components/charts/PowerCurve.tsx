import {useEffect, useMemo, useState} from 'react';
import {CartesianGrid, Line, ComposedChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis} from 'recharts';
import type {Sortie} from '../../types';
import {useStore} from '../../data/store';
import {groupPacks, packName} from '../../model/packs';
import {powerCurve, type CurvePoint} from '../../model/cockpit';
import {formatNumber} from '../../model/format';
import {useChartInk, useSeriesColor} from '../colors';

/** The width of a bin of collective (%) the typical line takes the median of. */
const BIN = 10;

/**
 * The power curve, as flight testing plots power needed against what the pilot asks for: the current drawn against
 * the collective, a cloud of points a pack (by its button), and the line all of them make (each bin's median). A pack
 * that needs more current for the same collective, or one that sags, stands out of the cloud.
 */
export function PowerCurve({sorties}: {sorties: Sortie[]}) {
  const {doc, loadSeries} = useStore();
  const ink = useChartInk();
  const color = useSeriesColor();
  // The logged packs named by their buttons: the files of each, to read.
  const flown = useMemo(
    () =>
      sorties.flatMap(sortie =>
        groupPacks(sortie.telemetry).flatMap(pack => {
          const name = packName(pack, doc.batteries);
          return name ? [{name, files: pack.files}] : [];
        }),
      ),
    [sorties, doc.batteries],
  );
  const [clouds, setClouds] = useState<Map<string, CurvePoint[]> | null>(null);

  useEffect(() => {
    let current = true;
    const load = async () => {
      const found = new Map<string, CurvePoint[]>();
      for (const {name, files} of flown) {
        for (const file of files) {
          const series = await loadSeries(file.id).catch(() => null);
          if (!series) continue;
          found.set(name, [...(found.get(name) ?? []), ...powerCurve(series, 120)]);
        }
      }
      if (current) setClouds(found);
    };
    void load();
    return () => {
      current = false;
    };
  }, [flown, loadSeries]);

  if (!flown.length) return <div className="muted">No pack flown with its button pressed yet.</div>;
  if (!clouds) return <div className="muted">Reading the logs…</div>;
  const names = [...clouds.keys()].sort((left, right) => left.localeCompare(right));
  if (!names.length) return <div className="muted">No log with the collective and the current to plot.</div>;

  // The typical line: each bin of collective's median current, over every pack.
  const bins = new Map<number, number[]>();
  for (const points of clouds.values()) {
    for (const point of points) {
      const bin = Math.round(point.pitch / BIN) * BIN;
      bins.set(bin, [...(bins.get(bin) ?? []), point.amps]);
    }
  }
  const typical = [...bins]
    .filter(([, values]) => values.length >= 5)
    .map(([pitch, values]) => ({
      pitch,
      typical: [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)],
    }))
    .sort((left, right) => left.pitch - right.pitch);

  return (
    <>
      <div className="chart tall">
        <ResponsiveContainer>
          <ComposedChart margin={{top: 10, right: 16, bottom: 0, left: -10}}>
            <CartesianGrid stroke={ink.grid} />
            <XAxis
              dataKey="pitch"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(value: number) => `${Math.round(value)} %`}
              tickLine={false}
              axisLine={{stroke: ink.axis}}
              allowDuplicatedCategory={false}
            />
            <YAxis
              dataKey="amps"
              type="number"
              tickFormatter={(value: number) => `${Math.round(value)} A`}
              tickLine={false}
              axisLine={false}
              width={50}
            />
            <Tooltip
              cursor={{stroke: ink.axis}}
              content={({active, payload}) => {
                const entry = payload?.[0];
                const point = entry?.payload as (CurvePoint & {typical?: number}) | undefined;
                if (!active || !entry || !point) return null;
                return (
                  <div className="tooltip">
                    <div className="tooltip-title">{formatNumber(point.pitch, 0)} % collective</div>
                    <div className="tooltip-row">
                      <span>
                        <i style={{background: String(entry.color)}} />
                        {entry.name}
                      </span>
                      <b>{formatNumber(point.amps ?? point.typical ?? 0, 1)} A</b>
                    </div>
                  </div>
                );
              }}
            />
            {names.map((name, index) => (
              <Scatter
                key={name}
                name={name}
                data={clouds.get(name)}
                dataKey="amps"
                fill={color(index)}
                fillOpacity={0.55}
                shape="circle"
                legendType="circle"
                isAnimationActive={false}
                r={2}
              />
            ))}
            <Line
              name="Typical"
              data={typical}
              dataKey="typical"
              stroke={ink.ink}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="chips" style={{marginTop: 10}}>
        {names.map((name, index) => (
          <span key={name} className="pill">
            <i className="dot" style={{background: color(index)}} /> {name}
          </span>
        ))}
        <span className="pill">
          <i className="dot" style={{background: ink.ink}} /> Typical
        </span>
      </div>
    </>
  );
}
