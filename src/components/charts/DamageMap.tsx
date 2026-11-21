import {lazy, Suspense, useMemo, useState} from 'react';
import {ChevronLeft} from 'lucide-react';
import type {Sortie} from '../../types';
import {damageByZone, ZONES, type Zone} from '../../model/debrief';

/**
 * A part that never broke is a dim green line, like the rest of the screen; a broken one glows orange, hotter the more
 * often it broke.
 */
const HEAT = ['#4d9068', '#9a5a22', '#d06a1c', '#ff7a1a', '#ffad5c'];

/**
 * The M2 EVO from the side, nose to the left, drawn as a thin wireframe. Each zone has its outline (one closed shape per
 * piece, filled by its heat; the canopy's window is cut out with the even-odd rule), a few contour lines that give it
 * volume, and the spot where its count goes.
 */
const SHAPES: Record<
  Zone,
  {outline: string[]; detail: string[]; label: [number, number]; anchor: 'start' | 'end' | 'middle'}
> = {
  // Two long, thin blades, bending down a little toward the tips, a line along each one's chord.
  blades: {
    outline: [
      'M250,48.8L250,43.3C243.7,43.3 224.8,43.4 212.2,43.5C199.6,43.7 186.9,43.9 174.3,44.2C161.7,44.4 149.1,44.7 136.5,45.1C123.9,45.5 111.3,45.9 98.7,46.4C86.1,46.9 73.4,47.4 60.8,48C48.2,48.6 29.3,49.6 23,49.9A2,2 0 0 0 23,53.8C29.3,53.5 48.2,52.6 60.8,52.2C73.4,51.7 86.1,51.2 98.7,50.8C111.3,50.4 123.9,50.1 136.5,49.8C149.1,49.5 161.7,49.3 174.3,49.1C186.9,49 199.6,48.8 212.2,48.8C224.8,48.7 243.7,48.8 250,48.8Z',
      'M318,48.8L318,43.3C324.3,43.3 343.2,43.4 355.8,43.5C368.4,43.7 381.1,43.9 393.7,44.2C406.3,44.4 418.9,44.7 431.5,45.1C444.1,45.5 456.7,45.9 469.3,46.4C481.9,46.9 494.6,47.4 507.2,48C519.8,48.6 538.7,49.6 545,49.9A2,2 0 0 1 545,53.8C538.7,53.5 519.8,52.6 507.2,52.2C494.6,51.7 481.9,51.2 469.3,50.8C456.7,50.4 444.1,50.1 431.5,49.8C418.9,49.5 406.3,49.3 393.7,49.1C381.1,49 368.4,48.8 355.8,48.8C343.2,48.7 324.3,48.8 318,48.8Z',
    ],
    detail: [
      'M248,46C241.9,46 223.6,46.1 211.3,46.2C199.1,46.3 186.9,46.4 174.7,46.6C162.4,46.9 150.2,47.1 138,47.4C125.8,47.7 113.6,48.1 101.3,48.5C89.1,48.9 76.9,49.4 64.7,49.9C52.4,50.4 34.1,51.3 28,51.6',
      'M320,46C326.1,46 344.4,46.1 356.7,46.2C368.9,46.3 381.1,46.4 393.3,46.6C405.6,46.9 417.8,47.1 430,47.4C442.2,47.7 454.4,48.1 466.7,48.5C478.9,48.9 491.1,49.4 503.3,49.9C515.6,50.4 533.9,51.3 540,51.6',
    ],
    label: [24, 41],
    anchor: 'start',
  },
  // The flybarless head: the hub, the two grips holding the blades, the links down to the swashplate.
  head: {
    outline: [
      'M276,41Q276,40 277,40L278.5,40Q279.5,40 279.5,39L279.5,37Q279.5,36 280.5,36L287.5,36Q288.5,36 288.5,37L288.5,39Q288.5,40 289.5,40L291,40Q292,40 292,41L292,52Q292,53 291,53L277,53Q276,53 276,52Z',
      'M275.2,41.5Q276,41.5 276,42.3L276,49.7Q276,50.5 275.2,50.5L262.8,50.5Q262,50.5 261.2,50.4L250.8,49.1Q250,49 250,48.2L250,43.8Q250,43 250.8,42.9L261.2,41.6Q262,41.5 262.8,41.5Z',
      'M292,42.3Q292,41.5 292.8,41.5L305.2,41.5Q306,41.5 306.8,41.6L317.2,42.9Q318,43 318,43.8L318,48.2Q318,49 317.2,49.1L306.8,50.4Q306,50.5 305.2,50.5L292.8,50.5Q292,50.5 292,49.7Z',
      'M266,50.5L268,50.5L268,58L266,58Z',
      'M300,50.5L302,50.5L302,58L300,58Z',
      'M266,59.2Q266,58 267.2,58L300.8,58Q302,58 302,59.2L302,60.3Q302,61.5 300.8,61.5L267.2,61.5Q266,61.5 266,60.3Z',
      'M263,62.9Q263,61.5 264.4,61.5L303.6,61.5Q305,61.5 305,62.9L305,64.1Q305,65.5 303.6,65.5L264.4,65.5Q263,65.5 263,64.1Z',
    ],
    detail: ['M281.8,46a2.2,2.2 0 1 0 4.4,0a2.2,2.2 0 1 0 -4.4,0Z'],
    label: [284, 29],
    anchor: 'middle',
  },
  // The main shaft, between the hub and the swashplate and down to its bearing on the frame.
  shaft: {
    outline: ['M281,53L287,53L287,58L281,58Z', 'M281,65.5L287,65.5L287,86L288.5,86L288.5,90L279.5,90L279.5,86L281,86Z'],
    detail: [],
    label: [276, 81],
    anchor: 'end',
  },
  // A bubble canopy like half an egg, round over the top into a blunt nose, its window following the curve, two
  // lines along its side and one across.
  canopy: {
    outline: [
      'M272,90C267.9,88.6 256.2,83.8 247.6,81.6C239,79.5 229.9,78 220.6,77C211.4,76.1 201.4,75.8 192,76.1C182.5,76.4 172.8,77.4 163.9,78.9C155,80.4 146.2,82.6 138.5,85.2C130.9,87.8 123.5,91.2 117.9,94.4C112.3,97.7 108.2,101.2 104.9,104.5C101.7,107.7 99.7,110.8 98.3,114C96.8,117.3 96.2,121.5 96,124C95.8,126.5 96.2,127.2 97,129C97.7,130.7 98.7,132.7 100.5,134.5C102.2,136.4 104.4,138.3 107.3,140.1C110.2,141.8 114.3,143.6 118,144.8C121.7,146 125.7,146.8 129.4,147.3C133,147.8 131.6,147.8 140,148C148.4,148.2 166,148.4 180,148.6C194,148.8 209.3,149.1 224,149.3C238.7,149.5 260.7,149.9 268,150C268.5,147.5 270,139.9 270.8,134.9C271.5,129.9 272.2,125.1 272.5,120.2C272.8,115.2 272.9,110.3 272.8,105.3C272.7,100.3 272.1,92.5 272,90Z',
      'M215.5,84.6C211.2,84.5 198.9,83.6 189.3,84.2C179.7,84.8 167.5,86 157.9,88C148.2,90 138.7,93.1 131.4,96.2C124.2,99.3 118.7,103 114.5,106.5C110.4,109.9 108,113.9 106.4,117.1C104.9,120.2 105.1,123.1 105.1,125.4C105.1,127.7 103.9,129.9 106.4,130.9C108.9,132 112.7,132.1 120,131.5C127.3,130.9 139.2,129.2 150,127.5C160.8,125.8 175.2,123.1 185,121.5C194.8,119.9 205,118.6 209,118C209.8,115.2 212.9,106.6 214,101C215.1,95.4 215.3,87.3 215.5,84.6Z',
    ],
    detail: [
      'M118.6,135.8C121.2,136 128.2,136.8 134.3,136.8C140.4,136.8 147.6,136.2 155.2,136.1C162.7,135.9 171.4,135.7 179.5,135.7C187.7,135.7 195.8,135.7 203.9,135.9C212,136 220.7,136.2 228.3,136.5C235.8,136.8 242.2,137.1 249.2,137.5C256.1,137.9 266.6,138.8 270.1,139.1',
      'M108.1,137.8C109.8,138.4 114.1,140.4 118.5,141.4C122.8,142.3 128,143.2 134,143.5C140.1,143.9 147.3,143.5 154.8,143.5C162.2,143.5 170.9,143.5 179,143.6C187,143.7 195.1,143.8 203.2,143.9C211.2,144 219.9,144.2 227.3,144.4C234.8,144.5 241.2,144.7 248.1,144.9C255,145.2 265.4,145.6 268.8,145.7',
      'M236.9,80.7C237,83.5 237.4,92 237.4,97.6C237.5,103.3 237.5,108.9 237.2,114.4C236.9,120 236.5,125.6 235.9,131.2C235.3,136.8 234.1,145.2 233.8,148.1',
    ],
    label: [88, 128],
    anchor: 'end',
  },
  // The frame behind the canopy, its boom clamp, the battery tray under the canopy. The servos are cut out of it.
  frame: {
    outline: [
      'M272,90L318,90C321,90.5 331,91.3 336,93C341,94.7 346,98.8 348,100L362,100L362,116L350,116C349,119.3 346,129 344,136C342,143 339,154.3 338,158L176,158C175.2,157.6 172.2,157.1 171.2,155.5C170.2,153.9 170.2,149.6 170,148.5C175,148.5 189.3,148.8 200,148.9C210.7,149.1 222.7,149.3 234,149.5C245.3,149.6 262.3,149.9 268,150C268.5,147.5 270,139.9 270.8,134.9C271.5,129.9 272.2,125.1 272.5,120.2C272.8,115.2 272.9,110.3 272.8,105.3C272.7,100.3 272.1,92.5 272,90Z',
      'M281,97.1Q281,96.5 281.6,96.5L294.4,96.5Q295,96.5 295,97.1L295,97.9Q295,98.5 294.4,98.5L290.1,98.5Q289.5,98.5 289.5,99.1L289.5,99.4Q289.5,100 290.1,100L292.4,100Q293,100 293,100.6L293,119.4Q293,120 292.4,120L283.6,120Q283,120 283,119.4L283,100.6Q283,100 283.6,100L285.9,100Q286.5,100 286.5,99.4L286.5,99.1Q286.5,98.5 285.9,98.5L281.6,98.5Q281,98.5 281,97.9Z',
      'M300,97.1Q300,96.5 300.6,96.5L313.4,96.5Q314,96.5 314,97.1L314,97.9Q314,98.5 313.4,98.5L309.1,98.5Q308.5,98.5 308.5,99.1L308.5,99.4Q308.5,100 309.1,100L311.4,100Q312,100 312,100.6L312,119.4Q312,120 311.4,120L302.6,120Q302,120 302,119.4L302,100.6Q302,100 302.6,100L304.9,100Q305.5,100 305.5,99.4L305.5,99.1Q305.5,98.5 304.9,98.5L300.6,98.5Q300,98.5 300,97.9Z',
      'M319,97.1Q319,96.5 319.6,96.5L332.4,96.5Q333,96.5 333,97.1L333,97.9Q333,98.5 332.4,98.5L328.1,98.5Q327.5,98.5 327.5,99.1L327.5,99.4Q327.5,100 328.1,100L330.4,100Q331,100 331,100.6L331,119.4Q331,120 330.4,120L321.6,120Q321,120 321,119.4L321,100.6Q321,100 321.6,100L323.9,100Q324.5,100 324.5,99.4L324.5,99.1Q324.5,98.5 323.9,98.5L319.6,98.5Q319,98.5 319,97.9Z',
    ],
    detail: ['M268,150L339.6,150'],
    label: [348, 150],
    anchor: 'start',
  },
  // Three servos on the frame, each with its horn on top.
  servos: {
    outline: [
      'M281,97.1Q281,96.5 281.6,96.5L294.4,96.5Q295,96.5 295,97.1L295,97.9Q295,98.5 294.4,98.5L290.1,98.5Q289.5,98.5 289.5,99.1L289.5,99.4Q289.5,100 290.1,100L292.4,100Q293,100 293,100.6L293,119.4Q293,120 292.4,120L283.6,120Q283,120 283,119.4L283,100.6Q283,100 283.6,100L285.9,100Q286.5,100 286.5,99.4L286.5,99.1Q286.5,98.5 285.9,98.5L281.6,98.5Q281,98.5 281,97.9Z',
      'M300,97.1Q300,96.5 300.6,96.5L313.4,96.5Q314,96.5 314,97.1L314,97.9Q314,98.5 313.4,98.5L309.1,98.5Q308.5,98.5 308.5,99.1L308.5,99.4Q308.5,100 309.1,100L311.4,100Q312,100 312,100.6L312,119.4Q312,120 311.4,120L302.6,120Q302,120 302,119.4L302,100.6Q302,100 302.6,100L304.9,100Q305.5,100 305.5,99.4L305.5,99.1Q305.5,98.5 304.9,98.5L300.6,98.5Q300,98.5 300,97.9Z',
      'M319,97.1Q319,96.5 319.6,96.5L332.4,96.5Q333,96.5 333,97.1L333,97.9Q333,98.5 332.4,98.5L328.1,98.5Q327.5,98.5 327.5,99.1L327.5,99.4Q327.5,100 328.1,100L330.4,100Q331,100 331,100.6L331,119.4Q331,120 330.4,120L321.6,120Q321,120 321,119.4L321,100.6Q321,100 321.6,100L323.9,100Q324.5,100 324.5,99.4L324.5,99.1Q324.5,98.5 323.9,98.5L319.6,98.5Q319,98.5 319,97.9Z',
    ],
    detail: [],
    label: [324.5, 84],
    anchor: 'middle',
  },
  // The main motor on top of the frame, under the swashplate: a can, the shaft through it.
  motor: {
    outline: ['M274,85Q274,83 276,83L292,83Q294,83 294,85L294,94Q294,96 292,96L276,96Q274,96 274,94Z'],
    detail: ['M274,89.5L294,89.5'],
    label: [268, 84],
    anchor: 'end',
  },
  // A slim tube from the frame's clamp to the tail motor, with one line along it.
  boom: {
    outline: ['M362,103.5L528,100.5L528,106.5L362,112.5Z'],
    detail: ['M364,106.6L526,102.6'],
    label: [442, 93],
    anchor: 'middle',
  },
  // The tail motor seen end on, its collar on the boom, the two tail blades behind it.
  tail: {
    outline: [
      'M528,98L540.8,98A12.5,12.5 0 0 0 540.8,109L528,109Z',
      'M539.5,103.5a12.5,12.5 0 1 0 25,0a12.5,12.5 0 1 0 -25,0Z',
      'M557.5,92.3C558.9,90.7 562.1,87.1 566,82.6C569.9,78.1 578.6,68.3 581.1,65.4A2.1,2.1 0 0 1 584.4,68.2C582.1,71.2 573.9,81.4 570.1,86.1C566.4,90.7 563.4,94.5 562.1,96.1A12.5,12.5 0 0 0 557.5,92.3Z',
      'M546.5,114.7C545.1,116.3 541.9,119.9 538,124.4C534.1,128.9 525.4,138.7 522.9,141.6A2.1,2.1 0 0 1 519.6,138.8C521.9,135.8 530.1,125.6 533.9,120.9C537.6,116.3 540.6,112.5 541.9,110.9A12.5,12.5 0 0 0 546.5,114.7Z',
    ],
    detail: ['M544,103.5a8,8 0 1 0 16,0a8,8 0 1 0 -16,0Z', 'M549.8,103.5a2.2,2.2 0 1 0 4.4,0a2.2,2.2 0 1 0 -4.4,0Z'],
    label: [574, 107],
    anchor: 'start',
  },
  // Two short struts down to a skid with a turned-up front.
  skids: {
    outline: [
      'M236.5,158L243.5,158C242.7,159.9 239.8,165.8 238.4,169.6C237,173.5 235.6,179.3 235,181.3L229,181.3C229.5,179.3 230.8,173.5 232,169.6C233.3,165.8 235.8,159.9 236.5,158Z',
      'M312.5,158L319.5,158C320.3,159.9 322.8,165.8 324,169.6C325.3,173.5 326.5,179.3 327,181.3L321,181.3C320.4,179.3 319,173.5 317.6,169.6C316.2,165.8 313.4,159.9 312.5,158Z',
      'M372,181.3C360,181.3 323.7,181.3 300,181.3C276.3,181.3 248.3,181.2 230,181.3C211.7,181.3 198.6,181.4 190.1,181.3C181.5,181.1 181.6,181 178.7,180.3C175.7,179.7 173.9,178.6 172.3,177.2C170.8,175.8 169.9,172.8 169.4,171.9A2.75,2.75 0 0 0 164.6,174.6C165.3,175.7 166.6,179.5 168.7,181.3C170.8,183.1 173.8,184.8 177.3,185.7C180.9,186.6 181.2,186.6 189.9,186.7C198.7,186.9 211.7,186.7 230,186.8C248.3,186.8 276.3,186.8 300,186.8C323.7,186.8 360,186.8 372,186.8A2.75,2.75 0 0 0 372,181.3Z',
    ],
    detail: [
      'M372,183.1C360,183.1 323.7,183.1 300,183.1C276.3,183.1 248.3,183.1 230,183.1C211.7,183.1 198.7,183.3 190,183.1C181.3,182.9 181.3,182.9 178,182.1C174.8,181.3 171.8,179 170.5,178.4',
      'M240,160L232,179.3',
      'M316,160L324,179.3',
    ],
    label: [160, 186],
    anchor: 'end',
  },
};

/** The heli in 3D, loaded with three.js only when a damage map shows. */
const DamageModel = lazy(() => import('./DamageModel'));

/** The order the parts are drawn in, back to front. */
const DRAW_ORDER: Zone[] = ['blades', 'shaft', 'head', 'frame', 'motor', 'servos', 'canopy', 'boom', 'tail', 'skids'];

/**
 * The heli in 3D, each part lit by how often it broke: the hotter, the more spares it ate. Hover or tap a part for what
 * broke there. The M2 EVO drawn flat from the side shows while the 3D one loads, and in its place without WebGL.
 */
export function DamageMap({sorties}: {sorties: Sortie[]}) {
  const {zones, unplaced} = useMemo(() => damageByZone(sorties), [sorties]);
  const [focus, setFocus] = useState<Zone | null>(null);
  // A part hovered in the list beside the heli: lit on it, the list staying as it is.
  const [hovered, setHovered] = useState<Zone | null>(null);
  const lit = focus ?? hovered;
  const max = Math.max(...[...zones.values()].map(zone => zone.qty), 1);
  const heat = (qty: number) => (qty ? HEAT[Math.min(4, 1 + Math.floor((qty / max) * 3.999))] : HEAT[0]);
  const shown = focus ? zones.get(focus) : null;
  const ranked = [...zones.values()].filter(zone => zone.qty).sort((left, right) => right.qty - left.qty);
  const colors = Object.fromEntries(ZONES.map(({key}) => [key, heat(zones.get(key)!.qty)])) as Record<Zone, string>;
  const counts = Object.fromEntries(ZONES.map(({key}) => [key, zones.get(key)!.qty])) as Record<Zone, number>;

  // The flat drawing: while the 3D one loads, and in its place without WebGL.
  const drawing = (
    <svg viewBox="12 12 586 178" className="damage-map" role="img" aria-label="Broken parts by part of the heli">
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
            className={`damage-zone ${lit === key ? 'focus' : ''}`}
            onMouseEnter={() => setFocus(key)}
            onMouseLeave={() => setFocus(null)}
            onFocus={() => setFocus(key)}
            onBlur={() => setFocus(null)}
          >
            <g className="damage-part" style={{color: heat(zone.qty)}}>
              <path
                d={shape.outline.join('')}
                fillRule="evenodd"
                className="damage-outline"
                style={{fillOpacity: zone.qty ? 0.16 : 0.05}}
              />
              {shape.detail.length > 0 && <path d={shape.detail.join('')} className="damage-detail" />}
            </g>
            {zone.qty > 0 && (
              <text x={shape.label[0]} y={shape.label[1]} textAnchor={shape.anchor} className="damage-count">
                {zone.qty}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );

  return (
    <div className="damage">
      <Suspense fallback={drawing}>
        <DamageModel colors={colors} counts={counts} focus={lit} onFocus={setFocus} fallback={drawing} />
      </Suspense>
      <div className="damage-side">
        {shown ? (
          <>
            {/* Back to every part: tapping the heli outside its parts does the same, but nobody would guess it. */}
            <button type="button" className="button small ghost damage-back" onClick={() => setFocus(null)}>
              <ChevronLeft size={14} /> All parts
            </button>
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
              <div
                key={zone.zone}
                className="bar-line damage-pick"
                onMouseEnter={() => setHovered(zone.zone)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => {
                  setHovered(null);
                  setFocus(zone.zone);
                }}
              >
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
