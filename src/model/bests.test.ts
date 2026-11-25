import {describe, expect, it} from 'vitest';
import {personalBests} from './bests';
import type {Sortie} from '../types';

const sortie = (date: string, packs: number, crashes: number | null) =>
  ({id: date, date, heliId: 'h', packs, crashes, telemetry: [], broken: [], skills: []}) as unknown as Sortie;

describe('personal bests', () => {
  it('finds the longest run of packs without a crash, a sortie with an unknown count left out', () => {
    const bests = personalBests(
      [
        sortie('2026-11-01', 3, 0),
        sortie('2026-11-02', 2, 1),
        sortie('2026-11-03', 2, 0),
        sortie('2026-11-04', 1, null),
        sortie('2026-11-05', 3, 0),
      ],
      new Map(),
    );
    expect(bests.cleanRun).toEqual({packs: 5, from: '2026-11-03', to: '2026-11-05'});
    expect(bests.inverted).toBeNull();
    expect(bests.flips).toBeNull();
  });
});
