import {useMemo, useState} from 'react';
import type {Sortie} from '../../types';
import {damageByZone, ZONES, type Zone} from '../../model/debrief';

/**
 * A part that never broke is a dim green line, like the rest of the screen; a broken one glows orange, hotter the more
 * often it broke.
 */
const HEAT = ['#2f7a4c', '#9a5a22', '#d06a1c', '#ff7a1a', '#ffad5c'];

/**
 * Where each zone sits on the drawing (the M2 EVO from the side, nose to the left, in thin lines), and where its count
 * goes. The holes (the canopy's decal, the frame's lightening hole) are cut out with the even-odd rule.
 */
const SHAPES: Record<Zone, {path: string; label: [number, number]; anchor: 'start' | 'end' | 'middle'}> = {
  // Long, thin blades: the M2's rotor spans about its whole length.
  blades: {
    path: 'M26,38.5 Q20,41 26,43.5 L229,44 L229,38 Z M271,38 L271,44 L474,43.5 Q480,41 474,38.5 Z',
    label: [24, 28],
    anchor: 'start',
  },
  // A compact head with its grips, the two links down to the swashplate just above the canopy.
  head: {
    path: 'M234,34 h32 a5,5 0 0 1 5,5 v3 a5,5 0 0 1 -5,5 h-32 a5,5 0 0 1 -5,-5 v-3 a5,5 0 0 1 5,-5 Z M240,47 h2.5 v14 h-2.5 Z M257.5,47 h2.5 v14 h-2.5 Z M236,61 h28 a2.5,2.5 0 0 1 0,5 h-28 a2.5,2.5 0 0 1 0,-5 Z',
    label: [282, 32],
    anchor: 'start',
  },
  shaft: {path: 'M247,47 h6 v14 h-6 Z M247,66 h6 v8 h-6 Z', label: [226, 60], anchor: 'end'},
  // The canopy: a rounded nose rising to a hump at the mast, its swoosh decal cut out.
  canopy: {
    path: 'M300,84 C286,74 258,70 232,72 C176,76 120,92 94,114 C80,126 84,142 100,146 L296,140 C304,124 306,100 300,84 Z M226,88 C186,92 152,104 132,120 L172,120 C190,108 212,100 240,96 Z',
    label: [80, 118],
    anchor: 'end',
  },
  // The carbon side plates behind the canopy, a lightening hole cut out, and the main motor under the canopy.
  frame: {
    path: 'M290,150 L300,94 L346,90 L350,96 L350,166 L290,166 Z M310,104 L340,100 L340,128 Z M262,146 h22 a3,3 0 0 1 3,3 v12 a3,3 0 0 1 -3,3 h-22 a3,3 0 0 1 -3,-3 v-12 a3,3 0 0 1 3,-3 Z',
    label: [360, 166],
    anchor: 'start',
  },
  // Three servos on the frame's side.
  servos: {
    path: 'M298,138 h14 v18 h-14 Z M316,138 h14 v18 h-14 Z M334,138 h12 v18 h-12 Z',
    label: [360, 140],
    anchor: 'start',
  },
  // A long, thin boom from the frame's top to the tail motor.
  boom: {path: 'M348,92 L528,87 L528,92 L348,100 Z', label: [438, 80], anchor: 'middle'},
  // The tail motor, the tail rotor's two long blades and hub, the small fin under it.
  tail: {
    path: 'M524,82 h16 a3,3 0 0 1 3,3 v8 a3,3 0 0 1 -3,3 h-16 Z M538,46 h5 l2,34 h-9 Z M536,98 h9 l-2,34 h-5 Z M540,89 m-4,0 a4,4 0 1 0 8,0 a4,4 0 1 0 -8,0 Z M516,96 L528,96 L534,120 L524,120 Z',
    label: [556, 92],
    anchor: 'start',
  },
  // The splayed struts down to a flat skid with turned-up ends.
  skids: {
    path: 'M294,166 l-34,40 h7 l34,-40 Z M334,166 l18,40 h7 l-18,-40 Z M246,206 h120 C374,206 378,202 380,198 a2.5,2.5 0 0 1 4.6,1.8 C382,206 376,212 366,212 h-120 C236,212 230,206 228,199.8 a2.5,2.5 0 0 1 4.6,-1.8 C234,202 238,206 246,206 Z',
    label: [240, 234],
    anchor: 'start',
  },
};

/** The order the parts are drawn in: the canopy over the frame's front, the servos on the frame. */
const DRAW_ORDER: Zone[] = ['blades', 'shaft', 'head', 'frame', 'servos', 'canopy', 'boom', 'tail', 'skids'];

/**
 * The M2 EVO drawn from the side, each part lit by how often it broke: the hotter, the more spares it ate. Hover or
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
        {DRAW_ORDER.map(key => {
          const label = ZONES.find(zone => zone.key === key)?.label ?? key;
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
              <path
                d={shape.path}
                fillRule="evenodd"
                style={{color: heat(zone.qty), fillOpacity: zone.qty ? 0.22 : 0.08}}
              />
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
              <div className="muted" style={{fontSize: '0.75rem'}}>
                {unplaced} more parts not placed on the drawing
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
