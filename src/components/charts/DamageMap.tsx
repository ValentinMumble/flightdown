import {useMemo, useState} from 'react';
import type {Sortie} from '../../types';
import {damageByZone, ZONES, type Zone} from '../../model/debrief';

/** One hue, dim to hot, for how often a part of the heli broke: amounts on the dark panel. */
const HEAT = ['#141a1d', '#3a2717', '#6e3613', '#b84d12', '#ff7a1a'];

/** Where each zone sits on the drawing, and where its label goes. */
const SHAPES: Record<Zone, {path: string; label: [number, number]; anchor: 'start' | 'end' | 'middle'}> = {
  blades: {path: 'M40,42 h420 a4,4 0 0 1 0,8 h-420 a4,4 0 0 1 0,-8 Z', label: [40, 30], anchor: 'start'},
  head: {
    path: 'M228,34 h44 a5,5 0 0 1 5,5 v14 a5,5 0 0 1 -5,5 h-44 a5,5 0 0 1 -5,-5 v-14 a5,5 0 0 1 5,-5 Z',
    label: [300, 30],
    anchor: 'start',
  },
  shaft: {path: 'M244,58 h12 v34 h-12 Z', label: [214, 76], anchor: 'end'},
  canopy: {
    path: 'M232,96 L160,96 C112,98 92,130 96,156 C100,180 128,192 172,192 L232,192 Z',
    label: [92, 118],
    anchor: 'end',
  },
  frame: {path: 'M236,92 h84 a10,10 0 0 1 10,10 v80 a10,10 0 0 1 -10,10 h-84 Z', label: [300, 214], anchor: 'start'},
  servos: {
    path: 'M246,104 h16 v14 h-16 Z M268,104 h16 v14 h-16 Z M290,104 h16 v14 h-16 Z',
    label: [338, 104],
    anchor: 'start',
  },
  boom: {path: 'M330,118 h196 a5,5 0 0 1 0,10 h-196 Z', label: [420, 110], anchor: 'middle'},
  tail: {
    path: 'M522,92 L546,96 L540,123 L522,123 Z M548,100 a24,24 0 1 1 0.1,0 Z M548,108 a16,16 0 1 0 0.1,0 Z',
    label: [580, 168],
    anchor: 'end',
  },
  skids: {
    path: 'M186,192 l-8,26 h8 l8,-26 Z M296,192 l8,26 h8 l-8,-26 Z M140,218 h196 a4,4 0 0 1 0,8 h-196 a6,6 0 0 1 -6,-6 v0 a6,6 0 0 1 6,-2 Z',
    label: [140, 246],
    anchor: 'start',
  },
};

/**
 * The heli drawn from the side, each part lit by how often it broke: the hotter, the more spares it ate. Hover or
 * focus a part for what broke there.
 */
export function DamageMap({sorties}: {sorties: Sortie[]}) {
  const {zones, unplaced} = useMemo(() => damageByZone(sorties), [sorties]);
  const [focus, setFocus] = useState<Zone | null>(null);
  const max = Math.max(...[...zones.values()].map(zone => zone.qty), 1);
  const heat = (qty: number) => (qty ? HEAT[Math.min(4, 1 + Math.floor((qty / max) * 3.999))] : HEAT[0]);
  const shown = focus ? zones.get(focus) : null;
  const ranked = [...zones.values()].filter(zone => zone.qty).sort((left, right) => right.qty - left.qty);

  return (
    <div className="damage">
      <svg viewBox="0 0 600 260" className="damage-map" role="img" aria-label="Broken parts by part of the heli">
        {ZONES.map(({key, label}) => {
          const zone = zones.get(key)!;
          const shape = SHAPES[key];
          return (
            <g
              key={key}
              tabIndex={0}
              role="button"
              aria-label={`${label}: ${zone.qty} broken`}
              className={`damage-zone ${focus === key ? 'focus' : ''}`}
              onMouseEnter={() => setFocus(key)}
              onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(key)}
              onBlur={() => setFocus(null)}
            >
              <path d={shape.path} fill={heat(zone.qty)} fillRule="evenodd" />
              {zone.qty > 0 && (
                <text x={shape.label[0]} y={shape.label[1]} textAnchor={shape.anchor} className="damage-count">
                  {zone.qty}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="damage-side">
        {shown ? (
          <>
            <div className="damage-title">{ZONES.find(zone => zone.key === shown.zone)?.label}</div>
            {shown.qty ? (
              [...shown.parts.values()]
                .sort((left, right) => right.qty - left.qty)
                .map(part => (
                  <div key={part.name} className="bar-line">
                    <span className="name">{part.name}</span>
                    <span className="value">× {part.qty}</span>
                  </div>
                ))
            ) : (
              <div className="muted">Never broke.</div>
            )}
          </>
        ) : (
          <>
            {ranked.slice(0, 5).map(zone => (
              <div key={zone.zone} className="bar-line">
                <span className="name">
                  <i className="dot" style={{background: heat(zone.qty), borderRadius: 3}} />
                  {ZONES.find(item => item.key === zone.zone)?.label}
                </span>
                <span className="value">× {zone.qty}</span>
              </div>
            ))}
            {!ranked.length && <div className="muted">Nothing broke. Nice.</div>}
            {unplaced > 0 && (
              <div className="muted" style={{fontSize: 12}}>
                {unplaced} more parts not placed on the drawing
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
