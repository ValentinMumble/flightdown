import {useState} from 'react';
import type {Session} from '../../types';
import {season} from '../../model/debrief';
import {formatAirtime} from '../../model/format';

const LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * The flying season as a rose: a petal a month of the year, all years together, its area for the airtime (so the
 * radius grows with the square root).
 */
export function SeasonRose({sessions}: {sessions: Session[]}) {
  const months = season(sessions);
  const max = Math.max(...months.map(month => month.airtime), 1);
  const [focus, setFocus] = useState<number | null>(null);
  const petal = (index: number, radius: number) => {
    const from = ((index * 30 - 90 - 13) * Math.PI) / 180;
    const to = ((index * 30 - 90 + 13) * Math.PI) / 180;
    const inner = 14;
    const point = (angle: number, length: number) =>
      `${100 + length * Math.cos(angle)},${100 + length * Math.sin(angle)}`;
    return `M${point(from, inner)} L${point(from, radius)} A${radius},${radius} 0 0 1 ${point(to, radius)} L${point(to, inner)} A${inner},${inner} 0 0 0 ${point(from, inner)} Z`;
  };
  const shown = focus === null ? null : months[focus];
  return (
    <div className="rose">
      <svg
        viewBox="0 0 200 200"
        role="img"
        aria-label="Airtime by month of the year"
        onMouseLeave={() => setFocus(null)}
      >
        {[0.33, 0.66, 1].map(ring => (
          <circle key={ring} cx={100} cy={100} r={14 + ring * 66} className="rose-ring" />
        ))}
        {months.map((month, index) => {
          const radius = 14 + Math.sqrt(month.airtime / max) * 66;
          const angle = ((index * 30 - 90) * Math.PI) / 180;
          return (
            <g key={index} onMouseEnter={() => setFocus(index)}>
              {month.airtime > 0 && (
                <path d={petal(index, radius)} className={`rose-petal ${focus === index ? 'focus' : ''}`} />
              )}
              <text
                x={100 + 92 * Math.cos(angle)}
                y={100 + 92 * Math.sin(angle) + 4}
                textAnchor="middle"
                className="rose-letter"
              >
                {LETTERS[index]}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="rose-caption">
        {shown ? (
          <>
            <b>{NAMES[shown.month]}</b> {formatAirtime(shown.airtime)} · {shown.sessions} sessions
          </>
        ) : (
          (() => {
            const best = months.reduce((top, month) => (month.airtime > top.airtime ? month : top), months[0]);
            return best.airtime ? (
              <>
                Busiest: <b>{NAMES[best.month]}</b>, {formatAirtime(best.airtime)}
              </>
            ) : (
              'No flying yet'
            );
          })()
        )}
      </div>
    </div>
  );
}
