import {describe, expect, it} from 'vitest';
import type {Sortie} from '../types';
import {clockAt, holdsInFlight, lastSession, packEvents, sessionEnd} from './session';

describe('the last session', () => {
  const sortie = (id: string, date: string, logs: number) =>
    ({id, date, telemetry: Array.from({length: logs}, (_, index) => ({id: `${id}${index}`}))}) as unknown as Sortie;

  it('is the latest sortie with radio logs', () => {
    expect(
      lastSession([sortie('a', '2026-11-13', 2), sortie('b', '2026-11-20', 3), sortie('c', '2026-11-21', 0)])?.id,
    ).toBe('b');
    expect(lastSession([sortie('c', '2026-11-21', 0)])).toBeNull();
  });

  it('ends when its last log does', () => {
    const ended = {
      telemetry: [
        {start: '2026-11-20T16:38:43', duration: 236},
        {start: '2026-11-20T16:42:56', duration: 155},
      ],
    } as unknown as Sortie;
    expect(sessionEnd(ended)?.getTime()).toBe(new Date('2026-11-20T16:45:31').getTime());
  });

  it('tells the time of day a moment of a pack fell at', () => {
    expect(clockAt('2026-11-20T16:32:08', 116)).toBe('16:34');
    expect(clockAt(undefined, 10)).toBe('');
  });
});

describe('throttle hold in flight', () => {
  // SF up (-1) runs the motor on the M2 EVO; flipped to hold at 10 A for a second (20 November), then on the ground.
  const time = [0, 1, 2, 3, 4, 5, 6, 7];
  const sf = [-1, -1, 1, -1, -1, 1, 1, 1];
  const current = [8, 10, 1, 1, 1, 1, 0, 0];
  const series = {id: 'pack', time, channels: {sf, current}};

  it('leaves out the landing: a hold flipped with the head spinning, never undone', () => {
    const landing = {id: 'pack', time: [0, 1, 2, 3], channels: {sf: [-1, -1, 1, 1], current: [6, 5, 1, 0]}};
    expect(holdsInFlight(landing, 'up')).toEqual([]);
  });

  it('finds a hold flipped under load and how soon it came back, not one on the ground', () => {
    expect(holdsInFlight(series, 'up')).toEqual([{at: 2, amps: 10, back: 1}]);
  });

  it('reads a switch thinned by averaging where it mostly was', () => {
    expect(holdsInFlight({...series, channels: {sf: [-1, -0.9, 0.8, -1, -1, 0.7, 1, 1], current}}, 'up')).toHaveLength(
      1,
    );
  });

  it('says it as an event of the pack', () => {
    expect(packEvents(series, 'up')[0]).toMatchObject({at: 2, text: 'throttle hold at 10 A, back on after 1 s'});
  });
});
