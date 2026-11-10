import {Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import type {TrendPoint} from '../../model/stats';
import {formatDay, formatRate, fromDay} from '../../model/format';
import {useChartInk, useSeriesColor} from '../colors';

/** Crashes every ten packs over the last ten sessions, session after session: one line, the learning curve. */
export function CrashTrend({points}: {points: TrendPoint[]}) {
  const ink = useChartInk();
  const stroke = useSeriesColor()(7);
  const rows = points.map(point => ({...point, time: fromDay(point.date).getTime()}));
  if (rows.length < 2) return <div className="muted">Ten sessions with a crash count are needed for this.</div>;
  const latest = rows[rows.length - 1];
  return (
    <div className="chart">
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{top: 10, right: 44, bottom: 0, left: -14}}>
          <CartesianGrid vertical={false} stroke={ink.grid} />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(time: number) => String(new Date(time).getFullYear())}
            tickLine={false}
            axisLine={{stroke: ink.axis}}
            minTickGap={40}
          />
          <YAxis tickLine={false} axisLine={false} width={46} allowDecimals={false} />
          <Tooltip
            cursor={{stroke: ink.axis}}
            content={({active, payload}) => {
              const row = payload?.[0]?.payload as (TrendPoint & {time: number}) | undefined;
              if (!active || !row) return null;
              return (
                <div className="tooltip">
                  <div className="tooltip-title">Ten sessions to {formatDay(row.date, {year: true})}</div>
                  <div className="tooltip-row">
                    <span>Crashes every 10 packs</span>
                    <b>{formatRate(row.per10)}</b>
                  </div>
                  <div className="tooltip-row">
                    <span>Packs per crash</span>
                    <b>{row.packsPerCrash === null ? 'no crash' : formatRate(row.packsPerCrash)}</b>
                  </div>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="per10"
            stroke={stroke}
            strokeWidth={2}
            fill={stroke}
            fillOpacity={0.1}
            dot={false}
            activeDot={{r: 4, stroke: ink.surface, strokeWidth: 2}}
            isAnimationActive={false}
            style={{filter: `drop-shadow(0 0 6px ${stroke})`}}
            label={({x, y, index}: {x?: number | string; y?: number | string; index?: number}) =>
              index === rows.length - 1 && x !== undefined && y !== undefined ? (
                <text x={Number(x) + 6} y={Number(y) + 4} fill={ink.ink} fontSize={12} fontWeight={700}>
                  {formatRate(latest.per10)}
                </text>
              ) : null
            }
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
