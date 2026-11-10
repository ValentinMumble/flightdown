import {useMemo} from 'react';
import {CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import {formatAirtime} from '../../model/format';
import {useChartInk, useDark} from '../colors';

/** Years are ordered: one hue, the latest year strongest, older years receding toward the card. */
const ORDINAL_LIGHT = ['#86b6ef', '#5598e7', '#2a78d6', '#184f95'];
const ORDINAL_DARK = ['#184f95', '#256abf', '#3987e5', '#86b6ef'];

const MONTH_DAYS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Airtime added up through each year: one line a year (the last four), each named at its end. */
export function YearLines({years}: {years: Map<number, {day: number; hours: number}[]>}) {
  const ink = useChartInk();
  const dark = useDark();
  const shown = useMemo(() => [...years.keys()].sort().slice(-4), [years]);
  const rows = useMemo(() => {
    const byDay = new Map<number, Record<string, number>>();
    for (const year of shown) {
      for (const point of years.get(year) ?? []) {
        const row = byDay.get(point.day) ?? {day: point.day};
        row[year] = point.hours;
        byDay.set(point.day, row);
      }
    }
    return [...byDay.values()].sort((left, right) => left.day - right.day);
  }, [years, shown]);
  const steps = dark ? ORDINAL_DARK : ORDINAL_LIGHT;
  const color = (index: number) => steps[steps.length - shown.length + index];

  return (
    <>
      <div className="chart tall">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{top: 10, right: 46, bottom: 0, left: -14}}>
            <CartesianGrid vertical={false} stroke={ink.grid} />
            <XAxis
              dataKey="day"
              type="number"
              domain={[0, 366]}
              ticks={MONTH_DAYS}
              tickFormatter={(day: number) => MONTHS[MONTH_DAYS.indexOf(day)] ?? ''}
              tickLine={false}
              axisLine={{stroke: ink.axis}}
            />
            <YAxis tickLine={false} axisLine={false} width={46} tickFormatter={(value: number) => `${value} h`} />
            <Tooltip
              cursor={{stroke: ink.axis}}
              content={({active, label}) => {
                if (!active || label === undefined) return null;
                const day = Number(label);
                return (
                  <div className="tooltip">
                    <div className="tooltip-title">By day {day} of the year</div>
                    {shown.map((year, index) => {
                      const points = years.get(year) ?? [];
                      const reached = [...points].reverse().find(point => point.day <= day);
                      return (
                        <div key={year} className="tooltip-row">
                          <span>
                            <i style={{background: color(index)}} />
                            {year}
                          </span>
                          <b>{formatAirtime((reached?.hours ?? 0) * 3600)}</b>
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            {shown.map((year, index) => (
              <Line
                key={year}
                dataKey={String(year)}
                type="stepAfter"
                stroke={color(index)}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
                label={({x, y, index: point}: {x?: number | string; y?: number | string; index?: number}) => {
                  const last = rows.reduce((found, row, rowIndex) => (row[year] !== undefined ? rowIndex : found), -1);
                  return point === last && x !== undefined && y !== undefined ? (
                    <text x={Number(x) + 6} y={Number(y) + 4} fill={ink.ink} fontSize={11} fontWeight={700}>
                      {year}
                    </text>
                  ) : null;
                }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="legend">
        {shown.map((year, index) => (
          <span key={year}>
            <i style={{background: color(index)}} />
            {year}
          </span>
        ))}
      </div>
    </>
  );
}
