import {useEffect, useMemo, useState} from 'react';
import {Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import type {TelemetryLog, TelemetrySeries} from '../../types';
import {useStore} from '../../data/store';
import {CHANNELS, type Channel} from '../../model/telemetry';
import {telemetryInsights} from '../../model/insights';
import {StickMap} from './StickMap';
import {formatTimer} from '../../model/format';
import {useChartInk} from '../colors';
import {StickReplay} from './StickReplay';

/** Avionics colours, a sensor each, as on a multi-function display. */
const TRACE: Partial<Record<Channel, string>> = {
  voltage: '#3ddc84',
  current: '#ffb020',
  capacity: '#e45bff',
  rssi: '#49cfe6',
  throttle: '#e8eef5',
};

const ORDER: Channel[] = ['voltage', 'current', 'capacity', 'rssi', 'throttle'];

/**
 * One EdgeTX log as small multiples: one chart a sensor, all on the same time axis, the hover shared between them
 * (never two scales on one chart).
 */
export function TelemetryCharts({log, pack}: {log: TelemetryLog; pack?: {cells?: number; capacity?: number}}) {
  const {loadSeries} = useStore();
  const ink = useChartInk();
  const [series, setSeries] = useState<TelemetrySeries | null | undefined>(undefined);
  // The replay's moment, shown as a cursor on every trace.
  const [cursor, setCursor] = useState<number | null>(null);

  useEffect(() => {
    let current = true;
    const load = async () => {
      const found = await loadSeries(log.id).catch(() => null);
      if (current) setSeries(found);
    };
    void load();
    return () => {
      current = false;
    };
  }, [log.id, loadSeries]);

  const rows = useMemo(
    () =>
      series
        ? series.time.map((second, index) =>
            Object.fromEntries([
              ['time', second],
              ...Object.entries(series.channels).map(([key, values]) => [key, values[index]]),
            ]),
          )
        : [],
    [series],
  );

  const insights = useMemo(() => (series ? telemetryInsights(log, series, pack) : []), [log, series, pack]);

  if (series === undefined) return <div className="muted">Loading the samples…</div>;
  if (series === null) return <div className="muted">The samples of this log could not be read.</div>;

  const channels = ORDER.filter(channel => series.channels[channel]?.length);
  return (
    <>
      {insights.length > 0 && (
        <div className="insights">
          {insights.map(insight => (
            <div key={insight.text} className={`insight ${insight.tone}`}>
              <span className="insight-icon" aria-hidden>
                {insight.icon}
              </span>
              <span>{insight.text}</span>
            </div>
          ))}
        </div>
      )}
      <div className="telemetry-grid">
        {channels.map(channel => {
          const {label, unit} = CHANNELS[channel];
          const stroke = TRACE[channel] ?? '#e8eef5';
          return (
            <div key={channel} className="telemetry-chart">
              <div className="telemetry-label">
                {label} <span className="muted">({unit})</span>
              </div>
              <div className="chart short">
                <ResponsiveContainer>
                  <AreaChart
                    data={rows}
                    syncId={`telemetry-${log.id}`}
                    margin={{top: 6, right: 6, bottom: 0, left: -14}}
                  >
                    <CartesianGrid vertical={false} stroke={ink.grid} />
                    <XAxis
                      dataKey="time"
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={(second: number) => formatTimer(second)}
                      tickLine={false}
                      axisLine={{stroke: ink.axis}}
                      minTickGap={24}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      domain={channel === 'voltage' ? ['auto', 'auto'] : [0, 'auto']}
                      width={46}
                      tickFormatter={(value: number) => String(Math.round(value * 10) / 10)}
                    />
                    <Tooltip
                      cursor={{stroke: ink.axis}}
                      content={({active, payload}) => {
                        const row = payload?.[0]?.payload as Record<string, number> | undefined;
                        if (!active || !row) return null;
                        return (
                          <div className="tooltip">
                            <div className="tooltip-title">{formatTimer(row.time)}</div>
                            <div className="tooltip-row">
                              <span>{label}</span>
                              <b>
                                {row[channel]} {unit}
                              </b>
                            </div>
                          </div>
                        );
                      }}
                    />
                    {cursor !== null && <ReferenceLine x={cursor} stroke="#7cffb2" strokeWidth={1.5} />}
                    <Area
                      type="monotone"
                      dataKey={channel}
                      stroke={stroke}
                      strokeWidth={2}
                      fill={stroke}
                      fillOpacity={0.1}
                      dot={false}
                      activeDot={{r: 4, stroke: ink.surface, strokeWidth: 2}}
                      isAnimationActive={false}
                      style={{filter: `drop-shadow(0 0 4px ${stroke})`}}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
      <StickMap series={series} />
      <StickReplay series={series} onTime={setCursor} />
    </>
  );
}
