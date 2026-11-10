import {describe, expect, it} from 'vitest';
import type {Session} from '../types';
import {causesOf, crashCauses, damageByZone, milestones, skillLadder, zoneOf} from './debrief';
import {WHOLE_HELI} from './parts';

let count = 0;
const session = (overrides: Partial<Session>): Session => ({
  id: `s${(count += 1)}`,
  date: '2023-03-01',
  heliId: 'h',
  packs: 4,
  timer: 300,
  crashes: 0,
  broken: [],
  skills: [],
  notes: '',
  links: [],
  telemetry: [],
  loggedAt: '',
  ...overrides,
});

describe('zoneOf', () => {
  it('places the parts of a log on the heli', () => {
    expect(zoneOf('Main blade')).toBe('blades');
    expect(zoneOf('Main shaft')).toBe('shaft');
    expect(zoneOf('Feathering shaft')).toBe('head');
    expect(zoneOf('Linkage rod')).toBe('head');
    expect(zoneOf('Elevator servo ball joint')).toBe('servos');
    expect(zoneOf('Tail boom')).toBe('boom');
    expect(zoneOf('Tail motor')).toBe('tail');
    expect(zoneOf('Canopy mount')).toBe('canopy');
    expect(zoneOf('Skids')).toBe('skids');
    expect(zoneOf('Main gear')).toBe('frame');
    expect(zoneOf(WHOLE_HELI)).toBeNull();
  });

  it('adds up each zone', () => {
    const {zones, unplaced} = damageByZone([
      session({
        broken: [
          {part: 'Main blade', qty: 2},
          {part: 'Mystery bit', qty: 1},
        ],
      }),
      session({
        broken: [
          {part: 'main blades', qty: 1},
          {part: WHOLE_HELI, qty: 1},
        ],
      }),
    ]);
    expect(zones.get('blades')?.qty).toBe(3);
    expect(zones.get('blades')?.parts.size).toBe(1);
    expect(unplaced).toBe(1);
  });
});

describe('crash causes', () => {
  it('reads causes from the notes', () => {
    expect(causesOf('Dumb thumb for 1st crash, 2nd when coming towards me')).toEqual(['thumb', 'sight']);
    expect(causesOf('Crashed into trees when overshooting')).toEqual(['overshoot', 'obstacle']);
    expect(causesOf('😳Tail blade broke in mid-air')).toEqual(['failure']);
    expect(causesOf('Too much wind, not very pleasing')).toEqual(['wind']);
  });

  it('counts crashes by cause and the ones with no cause', () => {
    const {causes, silent, total} = crashCauses([
      session({date: '2023-01-01'}),
      session({date: '2023-01-02'}),
      session({crashes: 2, notes: 'Crashed on a gust of wind'}),
      session({crashes: 1, notes: ''}),
      session({crashes: 0, notes: 'Wind all day, no crash'}),
    ]);
    expect(causes.get('wind')).toEqual({sessions: 1, crashes: 2});
    expect(silent).toBe(1);
    expect(total).toBe(3);
  });

  it('puts crashes on the first two sessions of a heli down to a new heli', () => {
    const {causes} = crashCauses([
      session({date: '2023-01-01', heliId: 'k123', crashes: 2}),
      session({date: '2023-01-02', heliId: 'k123', crashes: 1}),
      session({date: '2023-01-03', heliId: 'k123', crashes: 3}),
    ]);
    expect(causes.get('newheli')).toEqual({sessions: 2, crashes: 3});
  });
});

describe('skillLadder', () => {
  it('keeps the learning order and the first day of each rung', () => {
    const rungs = skillLadder([
      session({date: '2023-03-05', skills: ['Hurricanes']}),
      session({date: '2023-02-01', skills: ['Circles', 'Hurricanes']}),
    ]);
    expect(rungs[0].skill).toBe('Hover');
    expect(rungs.find(rung => rung.skill === 'Hurricanes')).toEqual({
      skill: 'Hurricanes',
      first: '2023-02-01',
      sessions: 2,
    });
  });
});

describe('milestones', () => {
  it('dates the hours reached and measures the next one', () => {
    const sessions = Array.from({length: 4}, (_, index) =>
      session({date: `2023-03-0${index + 1}`, packs: 6, timer: 300}),
    );
    const {reached, next} = milestones(sessions);
    expect(reached.find(mark => mark.label === '1 h in the air')?.date).toBe('2023-03-02');
    expect(reached.find(mark => mark.label === 'First flight')?.date).toBe('2023-03-01');
    const hours = next.find(mark => mark.label === '5 h in the air');
    expect(hours?.progress).toBeCloseTo(0.4);
    expect(hours?.toGo).toBe('3 h 00 to go');
  });
});
