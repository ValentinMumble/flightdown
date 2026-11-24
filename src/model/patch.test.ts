import {describe, expect, it} from 'vitest';
import {patchItem} from './patch';
import {applyChange} from '../data/store';
import {emptyDoc, type Sortie} from '../types';

const sortie: Sortie = {
  id: 'one',
  date: '2026-11-24',
  heliId: 'heli',
  spotId: 'moms',
  packs: 2,
  timer: 152,
  crashes: 4,
  crashTimes: ['2026-11-24T16:09:02'],
  broken: [],
  skills: [],
  notes: '',
  links: [],
  telemetry: [{id: 'log'} as Sortie['telemetry'][number]],
  loggedAt: '2026-11-24T18:00:00',
};

describe('patchItem', () => {
  it('sets the fields given and keeps the others', () => {
    const next = patchItem(sortie, {notes: 'windy', crashes: null});
    expect(next.notes).toBe('windy');
    expect(next.crashes).toBeNull();
    expect(next.telemetry).toEqual(sortie.telemetry);
    expect(next.crashTimes).toEqual(sortie.crashTimes);
  });

  it('takes out the fields dropped, never the id', () => {
    const next = patchItem(sortie, {id: 'other'}, ['spotId']);
    expect(next.id).toBe('one');
    expect('spotId' in next).toBe(false);
  });
});

describe('applyChange with a patch', () => {
  it('changes only the item named, as the server does', () => {
    const doc = {...emptyDoc(), sorties: [sortie, {...sortie, id: 'two'}]};
    const next = applyChange(doc, {type: 'patch', kind: 'sorties', id: 'two', fields: {packs: 5}});
    expect(next.sorties.map(one => one.packs)).toEqual([2, 5]);
  });

  it('leaves the log as it is when the item is gone', () => {
    const doc = {...emptyDoc(), sorties: [sortie]};
    expect(applyChange(doc, {type: 'patch', kind: 'sorties', id: 'gone', fields: {packs: 5}}).sorties).toEqual([
      sortie,
    ]);
  });
});
