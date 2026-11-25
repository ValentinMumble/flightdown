import {describe, expect, it} from 'vitest';
import type {Sortie, Spare} from '../types';
import {brokenRanking, parseBrokenParts, partKey, runwayText, spareRunway, spareStock, WHOLE_HELI} from './parts';

const sortie = (overrides: Partial<Sortie>): Sortie => ({
  id: 's',
  date: '2026-01-01',
  heliId: 'h',
  packs: 1,
  timer: 300,
  crashes: 0,
  broken: [],
  skills: [],
  notes: '',
  links: [],
  telemetry: [],
  loggedAt: '2026-01-01T20:00:00',
  ...overrides,
});

describe('parseBrokenParts', () => {
  it('reads the lines of a sheet cell, with counts and notes', () => {
    expect(parseBrokenParts('- Main blade x2\n- Tail boom (fixed on site)\n- 🚁\n- Bent blade grips ')).toEqual([
      {part: 'Main blade', qty: 2},
      {part: 'Tail boom', qty: 1, note: 'fixed on site'},
      {part: WHOLE_HELI, qty: 1},
      {part: 'Bent blade grips', qty: 1},
    ]);
  });

  it('reads nothing from a blank cell', () => {
    expect(parseBrokenParts(' ')).toEqual([]);
  });
});

describe('partKey', () => {
  it('matches spellings of one part', () => {
    expect(partKey(' Main  Blades')).toBe(partKey('main blade'));
    expect(partKey('Servo arm')).not.toBe(partKey('Servo'));
  });
});

describe('spareStock', () => {
  const spare: Spare = {id: 'p', name: 'Main blade', heliId: 'h', count: 4, countedAt: '2026-02-01T12:00:00', min: 2};

  it('takes off the parts broken in sorties logged after the count, on its heli', () => {
    const sorties = [
      sortie({loggedAt: '2026-01-15T20:00:00', broken: [{part: 'Main blade', qty: 2}]}),
      sortie({loggedAt: '2026-02-03T20:00:00', broken: [{part: 'main blades', qty: 2}]}),
      sortie({loggedAt: '2026-02-04T20:00:00', heliId: 'other', broken: [{part: 'Main blade', qty: 1}]}),
    ];
    expect(spareStock(spare, sorties)).toBe(2);
  });
});

describe('brokenRanking', () => {
  it('counts parts by quantity, whole helis aside', () => {
    const ranking = brokenRanking([
      sortie({
        date: '2026-01-01',
        broken: [
          {part: 'Main shaft', qty: 1},
          {part: WHOLE_HELI, qty: 1},
        ],
      }),
      sortie({
        date: '2026-01-02',
        heliId: 'other',
        broken: [
          {part: 'Main shaft', qty: 2},
          {part: 'Canopy', qty: 1},
        ],
      }),
    ]);
    expect(ranking.map(part => [part.name, part.qty, part.heliIds.length])).toEqual([
      ['Main shaft', 3, 2],
      ['Canopy', 1, 1],
    ]);
  });
});

describe('a spare runway', () => {
  const sortie = (date: string, packs: number, broken: {part: string; qty: number}[] = []) =>
    ({date, packs, heliId: 'k110', broken, loggedAt: `${date}T20:00:00`}) as unknown as Sortie;
  const spare = {id: 's', name: 'Tail blade', heliId: 'k110', count: 2, countedAt: '2026-01-01', min: 1} as Spare;

  it('lasts as long as the stock does at the rate it breaks and you fly now', () => {
    // 2 tail blades in 16 packs, all flown in the last 8 weeks: 1/8 a pack, 2 packs a week, so 1 every 4 weeks.
    const sorties = [
      sortie('2026-11-01', 8, [{part: 'Tail blades', qty: 1}]),
      sortie('2026-11-20', 8, [{part: 'tail blade', qty: 1}]),
    ];
    const runway = spareRunway(spare, sorties, 2, '2026-11-24');
    expect(runway.perPack).toBe(1 / 8);
    expect(runway.packsPerWeek).toBe(2);
    expect(runway.weeks).toBe(8);
    expect(runway.buy).toBe(0);
    expect(runwayText(runway.weeks)).toBe('about 2 months');
  });

  it('asks for enough to keep its minimum and the next weeks', () => {
    const sorties = [sortie('2026-11-20', 8, [{part: 'Tail blade', qty: 4}])];
    const runway = spareRunway(spare, sorties, 0, '2026-11-24');
    expect(runway.weeks).toBe(0);
    expect(runway.buy).toBe(2);
    expect(runwayText(runway.weeks)).toBe('runs out this week');
  });

  it('does not run out when the part never broke or the heli is not flown', () => {
    expect(spareRunway(spare, [sortie('2026-11-20', 8)], 2, '2026-11-24').weeks).toBeNull();
    expect(
      spareRunway(spare, [sortie('2025-01-20', 8, [{part: 'Tail blade', qty: 1}])], 2, '2026-11-24').weeks,
    ).toBeNull();
  });
});
