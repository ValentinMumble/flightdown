import {useEffect, useMemo, useRef, useState} from 'react';
import {useNavigate} from 'react-router';
import type {Heli, Sortie} from '../../types';
import {fleetLives} from '../../model/debrief';
import {daysBetween, formatAirtime, formatDay, today} from '../../model/format';
import {useSeriesColor} from '../colors';

const ROW = 38;
/** Below this width (a phone) the names and the endings get narrower margins. */
const NARROW = 600;

const END: Record<Heli['status'], string> = {
  active: 'Flying',
  grounded: 'Grounded',
  retired: 'Retired',
  sold: 'Sold',
  lost: 'Lost',
};

/**
 * Every heli's life on one time line: a bar from its first sortie to its last, a dot a sortie (bigger for more
 * packs), a red tick a crash, and how it left the hangar at the end.
 */
export function FleetTimeline({helis, sorties}: {helis: Heli[]; sorties: Sortie[]}) {
  const color = useSeriesColor();
  const navigate = useNavigate();
  const lives = useMemo(() => fleetLives(helis, sorties), [helis, sorties]);
  const [hover, setHover] = useState<{x: number; y: number; text: string} | null>(null);
  // Drawn at the width it is shown at, so the names keep their size on a phone.
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(300, element.clientWidth)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [lives.length > 0]);
  if (!lives.length) return <div className="muted">No sortie yet.</div>;

  const nameRoom = width < NARROW ? 90 : 128;
  const endRoom = width < NARROW ? 50 : 70;

  const start = lives[0].first;
  const end = today();
  const span = Math.max(1, daysBetween(start, end));
  const x = (day: string) => nameRoom + (daysBetween(start, day) / span) * (width - nameRoom - endRoom);
  const height = lives.length * ROW + 30;
  const years: number[] = [];
  for (let year = Number(start.slice(0, 4)) + 1; year <= Number(end.slice(0, 4)); year += 1) years.push(year);

  return (
    <div ref={box} className="timeline-scroll" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="fleet-timeline" role="img" aria-label="Each heli's life">
        {years.map(year => (
          <g key={year}>
            <line x1={x(`${year}-01-01`)} x2={x(`${year}-01-01`)} y1={0} y2={height - 22} className="timeline-grid" />
            <text x={x(`${year}-01-01`)} y={height - 6} textAnchor="middle" className="timeline-year">
              {year}
            </text>
          </g>
        ))}
        {lives.map((life, index) => {
          const y = index * ROW + 20;
          const hue = color(life.heli.color);
          const gone = life.heli.status !== 'active' && life.heli.status !== 'grounded';
          return (
            <g key={life.heli.id} className="timeline-row" onClick={() => navigate(`/helis/${life.heli.id}`)}>
              <text x={0} y={y + 4} className="timeline-name">
                {life.heli.name}
              </text>
              <rect
                x={x(life.first)}
                y={y - 3}
                width={Math.max(2, x(gone ? life.last : end) - x(life.first))}
                height={6}
                rx={3}
                fill={hue}
                opacity={0.35}
              />
              {life.sorties.map(sortie => (
                <g key={sortie.id}>
                  <circle
                    cx={x(sortie.date)}
                    cy={y}
                    r={2.5 + Math.min(4, sortie.packs * 0.6)}
                    fill={hue}
                    stroke="var(--panel)"
                    strokeWidth={1.5}
                    onMouseEnter={() =>
                      setHover({
                        x: x(sortie.date),
                        y,
                        text: `${life.heli.name} · ${formatDay(sortie.date, {year: true})} · ${sortie.packs} packs${sortie.crashes ? ` · 💥 ${sortie.crashes}` : ''}`,
                      })
                    }
                  />
                  {sortie.crashes > 0 && (
                    <line x1={x(sortie.date)} x2={x(sortie.date)} y1={y - 15} y2={y - 9} className="timeline-crash" />
                  )}
                </g>
              ))}
              <text x={width - endRoom + 10} y={y + 4} className={`timeline-end ${life.heli.status}`}>
                {END[life.heli.status]}
              </text>
              <title>{`${life.heli.name}: ${formatAirtime(life.airtime)} from ${formatDay(life.first, {year: true})} to ${formatDay(life.last, {year: true})}`}</title>
            </g>
          );
        })}
      </svg>
      {hover && (
        <div
          className="tooltip"
          style={{
            position: 'absolute',
            left: `${(hover.x / width) * 100}%`,
            top: hover.y + 18,
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {hover.text}
        </div>
      )}
    </div>
  );
}
