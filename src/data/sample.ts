import type {BrokenPart, Doc, Heli, Sortie, Spot, TelemetrySeries} from '../types';
import {addDays, daysBetween, fromDay, today} from '../model/format';

/**
 * A made-up log for visitors, on Valentin's own helis: two and a half years of learning, crashing less as he goes.
 * The same every time (a seeded random), ending a few days before today.
 */

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const HELIS: (Heli & {parts: string[]; from: number; to: number})[] = [
  {
    id: 'h-k123',
    name: 'K123',
    maker: 'WLtoys XK',
    model: 'K123',
    color: 4,
    status: 'sold',
    timer: 220,
    setup: 'Indoor only. Trim the tail before each pack.',
    parts: ['Canopy', 'Main gear', 'Main blade'],
    from: 0,
    to: 0.3,
    createdAt: '',
  },
  {
    id: 'h-t15',
    name: 'Align T15',
    maker: 'Align',
    model: 'T15',
    color: 2,
    status: 'sold',
    timer: 240,
    setup: 'Stock gains. Bluetooth app to find it in high grass.',
    parts: ['Main blade', 'Skid', 'Tail fin'],
    from: 0.05,
    to: 0.45,
    createdAt: '',
  },
  {
    id: 'h-m2',
    name: 'M2 EVO 🟠',
    maker: 'OMPHobby',
    model: 'M2 EVO',
    color: 1,
    status: 'active',
    timer: 280,
    battery: '3S 750 mAh',
    setup: 'FBL gains (speed, agile, gyro): rudder 5, 4 · elevator 5, 6, 3 · aileron 5, 6, 3.',
    parts: ['Main blade', 'Main shaft', 'Feathering shaft', 'Linkage rod', 'Servo arm', 'Tail boom', 'Tail blade'],
    from: 0.3,
    to: 1,
    createdAt: '',
  },
  {
    id: 'h-m4',
    name: 'M4',
    maker: 'OMPHobby',
    model: 'M4',
    color: 0,
    status: 'sold',
    timer: 420,
    battery: '3S 2000 mAh',
    setup: 'Rescue on SD switch.',
    parts: ['Main blade', 'Tail blade', 'Main shaft'],
    from: 0.6,
    to: 0.85,
    createdAt: '',
  },
];

const SPOTS: Spot[] = [
  {id: 'p-club', name: 'Club field', emoji: '✈️', lat: 48.71268, lng: 2.16585},
  {id: 'p-park', name: 'Park', emoji: '🌳', lat: 48.89255, lng: 2.39038},
  {id: 'p-garden', name: 'Garden', emoji: '🏡'},
  {id: 'p-beach', name: 'Beach', emoji: '🏖️', lat: 47.27321, lng: -2.36028},
  {id: 'p-home', name: 'Living room', emoji: '🛋️'},
];

/** The manoeuvres in the order this pilot gets to them, with how far through the log each starts. */
const PROGRESS: [string, number][] = [
  ['Hover', 0],
  ['Orientation', 0.06],
  ['Landings', 0.1],
  ['Circles', 0.18],
  ['Figure 8', 0.28],
  ['Forward flight', 0.33],
  ['Loops', 0.48],
  ['Flips', 0.52],
  ['Rolls', 0.58],
  ['Inverted', 0.66],
  ['Hurricanes', 0.8],
  ['Funnels', 0.9],
];

const CALM_NOTES = [
  'Nice sortie',
  'Smooth, no wind at all',
  'Felt good',
  'Long sortie with friends from the club',
  'Practised in the last light, lovely',
  'Tried a new throttle curve, much better',
  '',
  '',
];
const CRASH_NOTES = [
  'Dumb thumb on the last pack',
  'Lost orientation against the sun',
  'Too much wind, crashed on a gust',
  'Overshot a circle into the long grass',
  'Got too low coming out of the manoeuvre',
  'Clipped a branch',
];

export function sampleLog(end = addDays(today(), -3)): {doc: Doc; series: TelemetrySeries[]} {
  const random = seeded(42);
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
  const start = addDays(end, -900);
  const total = daysBetween(start, end);
  const sorties: Sortie[] = [];

  for (let day = 0; day <= total; day += 1) {
    const date = addDays(start, day);
    const progress = day / total;
    const month = fromDay(date).getMonth();
    const weekend = [0, 6].includes(fromDay(date).getDay());
    const summer = Math.cos(((month - 6) / 12) * 2 * Math.PI) * 0.5 + 0.5;
    const chance = (weekend ? 0.32 : 0.07) * (0.45 + summer * 0.8) * (progress > 0.55 && progress < 0.62 ? 0.15 : 1);
    if (random() > chance) continue;

    const flying = HELIS.filter(heli => progress >= heli.from && progress <= heli.to);
    const heli =
      flying.length > 1 && random() < 0.6 ? flying[flying.length - 1 - Math.floor(random() * 2)] : pick(flying);
    const micro = heli.id === 'h-k123';
    const spot = micro || (summer < 0.3 && random() < 0.4) ? SPOTS[4] : pick(SPOTS.slice(0, random() < 0.7 ? 2 : 4));
    const packs = 2 + Math.floor(random() * (micro ? 3 : 5));
    const skill = heli.id === 'h-m4' ? 0.35 : 0;
    const rate = Math.max(0.12, 1.3 - progress * 1.15 - skill) * (0.6 + random() * 0.8);
    let crashes = 0;
    for (let pack = 0; pack < packs; pack += 1) if (random() < rate / 3) crashes += 1;
    const broken: BrokenPart[] = [];
    for (let crash = 0; crash < crashes; crash += 1) {
      if (random() < 0.45) {
        const part = pick(heli.parts);
        const known = broken.find(item => item.part === part);
        if (known) known.qty += 1;
        else broken.push({part, qty: random() < 0.25 && part === 'Main blade' ? 2 : 1});
      }
    }
    const unlocked = PROGRESS.filter(([, from]) => progress >= from).map(([name]) => name);
    const skills = [...new Set(unlocked.slice(-3).filter(() => random() < 0.55))];
    if (!skills.length) skills.push(unlocked[unlocked.length - 1]);

    sorties.push({
      id: `s-${date}-${heli.id.slice(2)}`,
      date,
      heliId: heli.id,
      spotId: spot.id,
      packs,
      timer: (heli.timer ?? 300) - Math.round(random() * 2) * 15,
      crashes,
      broken,
      skills,
      notes: crashes ? pick(CRASH_NOTES) : pick(CALM_NOTES),
      links: [],
      telemetry: [],
      loggedAt: `${date}T20:00:00`,
    });
  }

  // One telemetry log on the latest M2 EVO sortie.
  const series: TelemetrySeries[] = [];
  const last = [...sorties].reverse().find(sortie => sortie.heliId === 'h-m2');
  if (last) {
    const time: number[] = [];
    const voltage: number[] = [];
    const current: number[] = [];
    const rssi: number[] = [];
    const throttle: number[] = [];
    const aileron: number[] = [];
    const elevator: number[] = [];
    const rudder: number[] = [];
    let used = 0;
    for (let second = 0; second <= 280; second += 1) {
      const burst = Math.sin(second / 9) * 0.5 + Math.sin(second / 23) * 0.5;
      const load = second < 15 ? second / 15 : 0.55 + burst * 0.35 + (random() - 0.5) * 0.2;
      const amps = Math.max(0.5, 1.5 + load * 9);
      used += (amps / 3600) * 1000;
      time.push(second);
      current.push(Math.round(amps * 10) / 10);
      voltage.push(Math.round((12.4 - (used / 750) * 1.5 - load * 0.45) * 100) / 100);
      rssi.push(Math.round(88 - Math.abs(Math.sin(second / 40)) * 22 - random() * 6));
      throttle.push(Math.round(Math.min(100, Math.max(0, 45 + load * 50))));
      aileron.push(Math.round(Math.sin(second / 6) * 35 + (random() - 0.5) * 30));
      elevator.push(Math.round(Math.cos(second / 7) * 30 + (random() - 0.5) * 25));
      rudder.push(Math.round(Math.sin(second / 11) * 20 + (random() - 0.5) * 20));
    }
    series.push({id: 't-sample', time, channels: {voltage, current, rssi, throttle, aileron, elevator, rudder}});
    last.telemetry.push({
      id: 't-sample',
      name: `M2 EVO-${last.date}-143012.csv`,
      start: `${last.date}T14:30:12`,
      duration: 280,
      samples: time.length,
      mAh: Math.round(used),
      minVoltage: Math.min(...voltage),
      maxCurrent: Math.max(...current),
      avgCurrent: Math.round((current.reduce((sum, value) => sum + value, 0) / current.length) * 10) / 10,
      minRssi: Math.min(...rssi),
    });
  }

  const counted = `${addDays(end, -60)}T12:00:00`;
  const doc: Doc = {
    helis: HELIS.map(({parts: _parts, from: _from, to: _to, ...heli}) => ({
      ...heli,
      acquired: sorties.find(sortie => sortie.heliId === heli.id)?.date,
      createdAt: `${start}T12:00:00`,
    })),
    spots: SPOTS,
    sorties,
    spares: [
      {id: 'sp-1', name: 'Main blade', heliId: 'h-m2', count: 6, countedAt: counted, min: 2, price: 6.5},
      {id: 'sp-2', name: 'Main shaft', heliId: 'h-m2', count: 3, countedAt: counted, min: 2, price: 4},
      {id: 'sp-3', name: 'Feathering shaft', heliId: 'h-m2', count: 2, countedAt: counted, min: 1, price: 3},
      {id: 'sp-4', name: 'Servo arm', heliId: 'h-m2', count: 4, countedAt: counted, min: 2, price: 2},
      {id: 'sp-5', name: 'Tail blade', heliId: 'h-m2', count: 3, countedAt: counted, min: 2, price: 3},
      {id: 'sp-6', name: 'Linkage rod', heliId: 'h-m2', count: 4, countedAt: counted, min: 2, price: 2.5},
    ],
    batteries: [
      {
        id: 'b-1',
        name: 'Small packs',
        cells: 3,
        capacity: 750,
        packs: [1, 2, 3, 4, 5, 6].map(number => ({number})),
        heliIds: ['h-m2'],
        bought: start,
      },
      {
        id: 'b-2',
        name: 'Old packs',
        cells: 3,
        capacity: 750,
        packs: [{number: 1}, {number: 2}],
        heliIds: ['h-m2'],
        notes: 'Puffy, for hovering only',
      },
    ],
    gear: [
      {
        id: 'g-radio',
        name: 'RadioMaster TX16S MKII',
        category: 'radio',
        details: '4-in-1 module, AG01 Hall CNC gimbals',
        since: sorties[0]?.date,
      },
      {id: 'g-charger', name: 'Charger', category: 'charger', details: '4 ports, balance charging at 1C'},
    ],
    tips: [
      {
        id: 'tip-1',
        title: 'Is the main shaft bent?',
        body: 'Give full collective and turn the main shaft slowly while touching the aileron guide: if it is bent, it moves.',
      },
      {
        id: 'tip-2',
        title: 'Level the swashplate',
        body: 'Plug the battery, set the servo arms at 90 degrees, put the leveller in place and adjust the links until the swashplate is flat.',
      },
      {
        id: 'tip-3',
        title: 'Charge at 1C',
        body: 'The safest charge rate for most LiPo packs is 1C: 1 A for a 1,000 mAh pack.',
      },
    ],
  };
  return {doc, series};
}
