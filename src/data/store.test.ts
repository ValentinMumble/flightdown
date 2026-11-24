import {describe, expect, it} from 'vitest';
import {afterRefusal, afterSent, applyChange} from './store';
import {emptyDoc, type Change, type Spot} from '../types';

const spot = (id: string, name: string): Spot => ({id, name});

describe('the outbox', () => {
  it('keeps changes the server refused for want of a sign-in', () => {
    expect(afterRefusal(401)).toBe('sign-in');
    expect(afterRefusal(403)).toBe('sign-in');
  });

  it('drops a change the server refused for good, and sends again when it was busy or unreachable', () => {
    expect(afterRefusal(400)).toBe('drop');
    expect(afterRefusal(413)).toBe('drop');
    expect(afterRefusal(408)).toBe('retry');
    expect(afterRefusal(429)).toBe('retry');
    expect(afterRefusal(503)).toBe('retry');
    expect(afterRefusal(undefined)).toBe('retry');
  });

  it('takes off only the change sent, not one another tab left at its head', () => {
    const first: Change = {type: 'put', kind: 'spots', item: spot('a', 'Field')};
    const second: Change = {type: 'delete', kind: 'spots', id: 'b'};
    expect(afterSent([first, second], first)).toEqual([second]);
    expect(afterSent([second], first)).toEqual([second]);
    expect(afterSent([], first)).toEqual([]);
  });
});

describe('a change', () => {
  it('adds an item, replaces it by id, and deletes it', () => {
    const added = applyChange(emptyDoc(), {type: 'put', kind: 'spots', item: spot('a', 'Field')});
    const renamed = applyChange(added, {type: 'put', kind: 'spots', item: spot('a', "Mom's")});
    expect(renamed.spots).toEqual([spot('a', "Mom's")]);
    expect(applyChange(renamed, {type: 'delete', kind: 'spots', id: 'a'}).spots).toEqual([]);
  });

  it('leaves the log as it is for samples, which are kept apart', () => {
    const doc = emptyDoc();
    const series = {id: 'log', time: [], channels: {}} as never;
    expect(applyChange(doc, {type: 'telemetry', series})).toBe(doc);
  });
});
