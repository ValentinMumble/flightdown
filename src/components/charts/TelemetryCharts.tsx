import {useMemo, useState} from 'react';
import {Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import type {TelemetrySeries} from '../../types';
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

/** Below this the radio lost the voltage for a sample. */
const NO_VOLTAGE = 0.5;

/** A sensor's value as the radio shows it: volts to the hundredth, amps to the tenth, the rest whole. */
const reading = (channel: Channel, value: number) =>
  channel === 'voltage' ? value.toFixed(2) : channel === 'current' ? value.toFixed(1) : String(Math.round(value));

/**
 * One pack's log as a flight data recorder: a thin lane a sensor, stacked on one time axis, each with its own scale
 * (never two on one chart) and its reading at the shared cursor, then the sticks.
 */
export function TelemetryCharts({
  series,
  mAh,
  pack,
  packs = [],
}: {
  series: TelemetrySeries;
  /** The mAh the pack used, for the notes. */
  mAh?: number;
  pack?: {cells?: number; capacity?: number};
  /** Every pack size the heli flies (mAh). */
  packs?: number[];
}) {
  const ink = useChartInk();
  // The replay's moment, shown as a cursor on every trace.
  const [cursor, setCursor] = useState<number | null>(null);

  const rows = useMemo(
    () =>
      series.time.map((second, index) =>
        Object.fromEntries([
          ['time', second],
          ...Object.entries(series.channels).map(([key, values]) => [key, values[index]]),
        ]),
      ),
    [series],
  );

  const insights = useMemo(() => telemetryInsights({mAh}, series, pack), [mAh, series, pack]);

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
      <div className="telemetry-lanes">
        {channels.map((channel, index) => {
          const {label, unit} = CHANNELS[channel];
          const stroke = TRACE[channel] ?? '#e8eef5';
          const last = index === channels.length - 1;
          const values = (series.channels[channel] ?? []).filter(value => channel !== 'voltage' || value >= NO_VOLTAGE);
          const low = values.length ? Math.min(...values) : 0;
          const high = values.length ? Math.max(...values) : 0;
          return (
            <div key={channel} className="telemetry-lane">
              <div className="telemetry-label">
                <span className="lane-key" style={{background: stroke}} aria-hidden />
                {label.toLowerCase()}
                <span className="lane-range">
                  {reading(channel, low)} to {reading(channel, high)} {unit}
                </span>
              </div>
              <div className={last ? 'lane-chart axis' : 'lane-chart'}>
                <ResponsiveContainer>
                  <AreaChart
                    data={rows}
                    syncId={`telemetry-${series.id}`}
                    margin={{top: 4, right: 6, bottom: 0, left: 0}}
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
                      hide={!last}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      domain={channel === 'voltage' ? ['auto', 'auto'] : [0, 'auto']}
                      width={34}
                      tickCount={3}
                      tickFormatter={(value: number) => String(Math.round(value * 10) / 10)}
                    />
                    <Tooltip
                      cursor={{stroke: ink.axis}}
                      position={{y: 0}}
                      allowEscapeViewBox={{x: false, y: true}}
                      isAnimationActive={false}
                      content={({active, payload}) => {
                        const row = payload?.[0]?.payload as Record<string, number> | undefined;
                        if (!active || !row || row[channel] === undefined) return null;
                        return (
                          <div className="lane-reading" style={{borderColor: stroke}}>
                            {index === 0 && <span>{formatTimer(row.time)}</span>}
                            <b>
                              {reading(channel, row[channel])} {unit}
                            </b>
                          </div>
                        );
                      }}
                    />
                    {cursor !== null && <ReferenceLine x={cursor} stroke="#7cffb2" strokeWidth={1.5} />}
                    <Area
                      type="monotone"
                      dataKey={channel}
                      stroke={stroke}
                      strokeWidth={1.6}
                      fill={stroke}
                      fillOpacity={0.1}
                      dot={false}
                      activeDot={{r: 3.5, stroke: ink.surface, strokeWidth: 2}}
                      isAnimationActive={false}
                      style={{filter: `drop-shadow(0 0 3px ${stroke})`}}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
      <StickMap series={series} />
      <StickReplay series={series} pack={pack} packs={packs} onTime={setCursor} />
    </>
  );
}
