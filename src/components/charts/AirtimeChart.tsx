import {useMemo} from 'react';
import {Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import type {MonthTally} from '../../model/stats';
import {formatAirtime, formatMonth, shortMonth} from '../../model/format';
import {useStore} from '../../data/store';
import {useChartInk, useSeriesColor} from '../colors';

/** Past this many helis in one chart, the least flown fold into "Other". */
const MAX_SERIES = 5;
const OTHER = 'other';

interface SegmentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: Record<string, number | string>;
}

/** A stacked segment: a 2px gap above it, and rounded corners when it is the top of its column. */
function segment(key: string, topOf: (row: Record<string, number | string>) => string | undefined) {
  return function Segment({x = 0, y = 0, width = 0, height = 0, fill, payload}: SegmentProps) {
    if (height <= 0) return null;
    const top = payload ? topOf(payload) === key : false;
    const gap = top ? 0 : Math.min(2, height / 2);
    const tall = height - gap;
    const radius = top ? Math.min(4, tall, width / 2) : 0;
    const left = x;
    const right = x + width;
    const upper = y + gap;
    const lower = y + height;
    const path = radius
      ? `M${left},${lower} V${upper + radius} Q${left},${upper} ${left + radius},${upper} H${right - radius} Q${right},${upper} ${right},${upper + radius} V${lower} Z`
      : `M${left},${lower} V${upper} H${right} V${lower} Z`;
    return <path d={path} fill={fill} />;
  };
}

/** Airtime month by month, one stacked column a month, one colour a heli. */
export function AirtimeChart({months, short = false}: {months: MonthTally[]; short?: boolean}) {
  const {heli} = useStore();
  const color = useSeriesColor();
  const ink = useChartInk();

  const {rows, keys} = useMemo(() => {
    const totalsByHeli = new Map<string, number>();
    for (const month of months) {
      for (const [id, seconds] of Object.entries(month.byHeli)) {
        totalsByHeli.set(id, (totalsByHeli.get(id) ?? 0) + seconds);
      }
    }
    const ranked = [...totalsByHeli.entries()].sort((left, right) => right[1] - left[1]).map(([id]) => id);
    const shown = ranked.length > MAX_SERIES ? ranked.slice(0, MAX_SERIES - 1) : ranked;
    const folded = ranked.length > shown.length;
    // Stacked in the helis' palette order, so a heli sits at the same height in every column.
    const ordered = shown.sort((left, right) => (heli(left)?.color ?? 9) - (heli(right)?.color ?? 9));
    const seriesKeys = folded ? [...ordered, OTHER] : ordered;
    const data = months.map(month => {
      const row: Record<string, number | string> = {month: month.month, total: month.airtime / 3600};
      for (const key of seriesKeys) row[key] = 0;
      for (const [id, seconds] of Object.entries(month.byHeli)) {
        const key = seriesKeys.includes(id) ? id : OTHER;
        row[key] = (row[key] as number) + seconds / 3600;
      }
      return row;
    });
    return {rows: data, keys: seriesKeys};
  }, [months, heli]);

  const topOf = (row: Record<string, number | string>) => [...keys].reverse().find(key => (row[key] as number) > 0);
  const label = (key: string) => (key === OTHER ? 'Other helis' : (heli(key)?.name ?? 'Unknown'));
  const fill = (key: string) => (key === OTHER ? color(-1) : color(heli(key)?.color ?? -1));

  if (!months.length) return <div className="chart short" />;

  return (
    <>
      <div className={`chart ${short ? 'short' : 'tall'}`}>
        <ResponsiveContainer>
          <BarChart data={rows} margin={{top: 6, right: 4, bottom: 0, left: -18}} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={ink.grid} />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={{stroke: ink.axis}}
              tickFormatter={(month: string) =>
                month.endsWith('-01') ? `${shortMonth(month)} ’${month.slice(2, 4)}` : shortMonth(month)
              }
              minTickGap={8}
              interval="preserveStartEnd"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              tickFormatter={(value: number) => `${value} h`}
              width={52}
            />
            <Tooltip
              cursor={{fill: ink.grid, opacity: 0.5}}
              content={({active, payload}) => {
                const row = payload?.[0]?.payload as Record<string, number | string> | undefined;
                if (!active || !row) return null;
                return (
                  <div className="tooltip">
                    <div className="tooltip-title">{formatMonth(row.month as string, true)}</div>
                    {keys
                      .filter(key => (row[key] as number) > 0)
                      .map(key => (
                        <div key={key} className="tooltip-row">
                          <span>
                            <i style={{background: fill(key)}} />
                            {label(key)}
                          </span>
                          <b>{formatAirtime((row[key] as number) * 3600)}</b>
                        </div>
                      ))}
                    <div className="tooltip-row" style={{marginTop: 4}}>
                      <span>Total</span>
                      <b>{formatAirtime((row.total as number) * 3600)}</b>
                    </div>
                  </div>
                );
              }}
            />
            {keys.map(key => (
              <Bar
                key={key}
                dataKey={key}
                stackId="airtime"
                fill={fill(key)}
                maxBarSize={24}
                isAnimationActive={false}
                shape={segment(key, topOf)}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {keys.length > 1 && (
        <div className="legend">
          {keys.map(key => (
            <span key={key}>
              <i style={{background: fill(key)}} />
              {label(key)}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
