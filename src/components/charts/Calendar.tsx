import {useMemo, useState} from 'react';
import {addDays, formatAirtime, formatDay, fromDay, toDay} from '../../model/format';
import {useRamp} from '../colors';

const CELL = 13;
const GAP = 3;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A year of flying days, a square a day, darker for more airtime (one hue, as amounts are). */
export function Calendar({year, days}: {year: number; days: Map<string, number>}) {
  const ramp = useRamp();
  const [hover, setHover] = useState<{day: string; x: number; y: number} | null>(null);
  const {cells, weeks, monthStarts} = useMemo(() => {
    const first = `${year}-01-01`;
    const offset = (fromDay(first).getDay() + 6) % 7;
    const start = addDays(first, -offset);
    const list: {day: string; week: number; weekday: number}[] = [];
    const starts: {month: number; week: number}[] = [];
    for (let index = 0; ; index += 1) {
      const day = addDays(start, index);
      const date = fromDay(day);
      if (date.getFullYear() > year) break;
      const week = Math.floor(index / 7);
      if (date.getFullYear() === year) {
        list.push({day, week, weekday: index % 7});
        if (date.getDate() === 1) starts.push({month: date.getMonth(), week});
      }
    }
    return {cells: list, weeks: list[list.length - 1].week + 1, monthStarts: starts};
  }, [year]);

  const step = (seconds: number) => {
    if (!seconds) return ramp[0];
    if (seconds < 15 * 60) return ramp[1];
    if (seconds < 25 * 60) return ramp[2];
    if (seconds < 40 * 60) return ramp[3];
    return ramp[4];
  };
  const width = weeks * (CELL + GAP) + 24;
  const height = 7 * (CELL + GAP) + 20;
  const now = toDay(new Date());

  return (
    <div className="calendar" style={{position: 'relative'}} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label={`Flying days in ${year}`}>
        {monthStarts.map(({month, week}) => (
          <text key={month} x={24 + week * (CELL + GAP)} y={10} fontSize="0.625rem" fill="var(--muted)">
            {MONTHS[month]}
          </text>
        ))}
        {['Mon', 'Wed', 'Fri'].map((label, index) => (
          <text key={label} x={0} y={20 + (index * 2 + 1) * (CELL + GAP) - 3} fontSize="0.5625rem" fill="var(--muted)">
            {label}
          </text>
        ))}
        {cells.map(({day, week, weekday}) => (
          <rect
            key={day}
            x={24 + week * (CELL + GAP)}
            y={16 + weekday * (CELL + GAP)}
            width={CELL}
            height={CELL}
            rx={3}
            fill={day > now ? 'transparent' : step(days.get(day) ?? 0)}
            stroke={day === now ? 'var(--accent)' : 'none'}
            onMouseEnter={() => setHover({day, x: 24 + week * (CELL + GAP), y: 16 + weekday * (CELL + GAP)})}
          />
        ))}
      </svg>
      {hover && (
        <div
          className="tooltip"
          style={{
            position: 'absolute',
            left: Math.min(hover.x, width - 150),
            top: hover.y + CELL + 6,
            pointerEvents: 'none',
          }}
        >
          <div className="tooltip-title">{formatDay(hover.day, {year: true})}</div>
          {days.get(hover.day) ? formatAirtime(days.get(hover.day)!) + ' in the air' : 'No flight'}
        </div>
      )}
      <div className="legend" style={{marginTop: 4}}>
        <span>Less</span>
        {ramp.map(color => (
          <i key={color} style={{background: color}} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
