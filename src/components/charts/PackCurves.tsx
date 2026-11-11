import {useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router';
import {CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import type {Sortie, TelemetryLog, TelemetrySeries} from '../../types';
import {useStore} from '../../data/store';
import {estimateCells, packOf} from '../../model/insights';
import {formatDay, formatNumber, formatTimer, fromDay, shortMonth} from '../../model/format';
import {groupPacks} from '../../model/packs';
import {useChartInk, useSeriesColor} from '../colors';

const IDLE_AMPS = 2;

interface Curve {
  key: string;
  sortie: Sortie;
  log: TelemetryLog;
  /** Volts a cell under load, by seconds into the powered flight. */
  points: {second: number; cell: number}[];
  lowest: number;
  average: number;
  flight: number;
}

/** A log as volts a cell over the powered flight, every five seconds or so. */
function curveOf(sortie: Sortie, log: TelemetryLog, series: TelemetrySeries, cells: number): Curve | null {
  const voltage = series.channels.voltage ?? [];
  const current = series.channels.current ?? [];
  if (!voltage.length || !current.length) return null;
  const first = current.findIndex(amps => amps >= IDLE_AMPS);
  if (first < 0) return null;
  const last = current.length - 1 - [...current].reverse().findIndex(amps => amps >= IDLE_AMPS);
  const points: Curve['points'] = [];
  let next = 0;
  for (let index = first; index <= last; index += 1) {
    const second = series.time[index] - series.time[first];
    if (second < next || current[index] < IDLE_AMPS || voltage[index] < 0.5) continue;
    points.push({second: Math.round(second), cell: Math.round((voltage[index] / cells) * 100) / 100});
    next = second + 5;
  }
  const flyingCurrent = current.slice(first, last + 1).filter(amps => amps >= IDLE_AMPS);
  return {
    key: log.id,
    sortie,
    log,
    points,
    lowest: Math.min(...points.map(point => point.cell)),
    average: flyingCurrent.reduce((sum, amps) => sum + amps, 0) / Math.max(1, flyingCurrent.length),
    flight: series.time[last] - series.time[first],
  };
}

/**
 * Every log's pack on one chart: volts a cell under load through the flight, with the 3.5 V to land at and the
 * 3.3 V a LiPo should never see. Packs flown harder sag sooner.
 */
export function PackCurves({sorties}: {sorties: Sortie[]}) {
  const {doc, heli, loadSeries} = useStore();
  const ink = useChartInk();
  const color = useSeriesColor();
  const logs = useMemo(() => sorties.flatMap(sortie => sortie.telemetry.map(log => ({sortie, log}))), [sorties]);
  const [curves, setCurves] = useState<Curve[] | null>(null);

  useEffect(() => {
    let current = true;
    const load = async () => {
      const found: Curve[] = [];
      for (const {sortie, log} of logs) {
        const series = await loadSeries(log.id).catch(() => null);
        if (!series) continue;
        const pack = packOf(heli(sortie.heliId), doc.batteries);
        const cells = pack.cells ?? estimateCells(Math.max(...(series.channels.voltage ?? [0])));
        const curve = curveOf(sortie, log, series, cells);
        if (curve && curve.flight >= 20 && curve.points.length > 2) found.push(curve);
      }
      if (current) setCurves(found);
    };
    void load();
    return () => {
      current = false;
    };
  }, [logs, loadSeries, heli, doc.batteries]);

  if (!logs.length) return <div className="muted">No telemetry log yet: add EdgeTX logs to a sortie.</div>;
  if (!curves) return <div className="muted">Reading the logs…</div>;
  if (!curves.length) return <div className="muted">No log with voltage and current to compare.</div>;

  const name = (curve: Curve) =>
    `${formatDay(curve.sortie.date, {weekday: false, year: true})}, ${curve.log.start?.slice(11, 16) ?? ''}`;
  // "28 Apr ’23 · pack 2": short enough for a phone's table, the pack counted as the sortie's cards count it, and a
  // letter for each file of a pack the radio logged in several (2a, 2b).
  const shortName = (curve: Curve) => {
    const packs = groupPacks(curve.sortie.telemetry);
    const index = packs.findIndex(pack => pack.files.some(file => file.id === curve.log.id));
    const day = `${fromDay(curve.sortie.date).getDate()} ${shortMonth(curve.sortie.date)} ’${curve.sortie.date.slice(2, 4)}`;
    if (index < 0 || (packs.length < 2 && packs[index].files.length < 2)) return day;
    const files = packs[index].files;
    const part = files.length > 1 ? 'abcdefghij'[files.findIndex(file => file.id === curve.log.id)] : '';
    return `${day} · pack ${index + 1}${part}`;
  };
  const rows = new Map<number, Record<string, number>>();
  for (const curve of curves) {
    for (const point of curve.points) {
      const row = rows.get(point.second) ?? {second: point.second};
      row[curve.key] = point.cell;
      rows.set(point.second, row);
    }
  }
  const data = [...rows.values()].sort((left, right) => left.second - right.second);

  return (
    <>
      <div className="chart tall">
        <ResponsiveContainer>
          <LineChart data={data} margin={{top: 10, right: 16, bottom: 0, left: -10}}>
            <CartesianGrid vertical={false} stroke={ink.grid} />
            <XAxis
              dataKey="second"
              type="number"
              domain={[0, 'dataMax']}
              tickFormatter={(second: number) => formatTimer(second)}
              tickLine={false}
              axisLine={{stroke: ink.axis}}
              minTickGap={30}
            />
            <YAxis
              domain={[(minimum: number) => Math.min(3.2, Math.floor(minimum * 10) / 10), 4.25]}
              tickFormatter={(value: number) => `${formatNumber(value, 1)} V`}
              tickLine={false}
              axisLine={false}
              width={52}
              allowDataOverflow
            />
            <ReferenceLine
              y={3.5}
              stroke="var(--caution)"
              strokeDasharray="4 4"
              label={{value: 'Land 3.5 V', fill: '#ffb020', fontSize: 11, position: 'insideBottomLeft'}}
            />
            <ReferenceLine
              y={3.3}
              stroke="var(--warning)"
              strokeDasharray="4 4"
              label={{value: 'Never 3.3 V', fill: '#ff4d4f', fontSize: 11, position: 'insideTopLeft'}}
            />
            <Tooltip
              cursor={{stroke: ink.axis}}
              content={({active, label, payload}) => {
                if (!active || label === undefined || !payload?.length) return null;
                return (
                  <div className="tooltip">
                    <div className="tooltip-title">{formatTimer(Number(label))} into the flight</div>
                    {payload.map(entry => {
                      const curve = curves.find(item => item.key === entry.dataKey);
                      return curve ? (
                        <div key={curve.key} className="tooltip-row">
                          <span>
                            <i style={{background: String(entry.color)}} />
                            {name(curve)}
                          </span>
                          <b>{formatNumber(Number(entry.value), 2)} V</b>
                        </div>
                      ) : null;
                    })}
                  </div>
                );
              }}
            />
            {curves.map((curve, index) => (
              <Line
                key={curve.key}
                dataKey={curve.key}
                type="monotone"
                stroke={color(index)}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
                style={{filter: `drop-shadow(0 0 4px ${color(index)})`}}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="spot-table" style={{marginTop: 12}}>
        <div className="spot-row head">
          <span>Log</span>
          <span>Flight</span>
          <span>Average</span>
          <span>Lowest</span>
        </div>
        {curves.map((curve, index) => (
          <Link key={curve.key} to={`/sorties/${curve.sortie.id}`} className="spot-row">
            <span className="name with-dot">
              <i className="dot" style={{background: color(index)}} />
              <span className="name-main">{shortName(curve)}</span>
              <small className="name-note">{heli(curve.sortie.heliId)?.name}</small>
            </span>
            <span>{formatTimer(curve.flight)}</span>
            <span>{formatNumber(curve.average, 1)} A</span>
            <span
              style={{
                color: curve.lowest < 3.3 ? 'var(--warning)' : curve.lowest < 3.5 ? 'var(--caution)' : 'var(--good)',
              }}
            >
              {formatNumber(curve.lowest, 2)} V
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
