import {describe, expect, it} from 'vitest';
import type {Session, Spare} from '../types';
import {brokenRanking, parseBrokenParts, partKey, spareStock, WHOLE_HELI} from './parts';

const session = (overrides: Partial<Session>): Session => ({
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

  it('takes off the parts broken in sessions logged after the count, on its heli', () => {
    const sessions = [
      session({loggedAt: '2026-01-15T20:00:00', broken: [{part: 'Main blade', qty: 2}]}),
      session({loggedAt: '2026-02-03T20:00:00', broken: [{part: 'main blades', qty: 2}]}),
      session({loggedAt: '2026-02-04T20:00:00', heliId: 'other', broken: [{part: 'Main blade', qty: 1}]}),
    ];
    expect(spareStock(spare, sessions)).toBe(2);
  });
});

describe('brokenRanking', () => {
  it('counts parts by quantity, whole helis aside', () => {
    const ranking = brokenRanking([
      session({
        date: '2026-01-01',
        broken: [
          {part: 'Main shaft', qty: 1},
          {part: WHOLE_HELI, qty: 1},
        ],
      }),
      session({
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
