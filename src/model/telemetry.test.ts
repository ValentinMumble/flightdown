import {describe, expect, it} from 'vitest';
import type {Session} from '../types';
import {parseCsv} from './csv';
import {matchSession, modelFromFileName, readDay, readTelemetry} from './telemetry';
import {estimateCells, packOf, telemetryInsights} from './insights';

/** A made-up EdgeTX log of a 3S pack: hover, then the pack sags and the ESC cuts with the throttle up. */
function edgeTxLog() {
  const lines = ['Date,Time,RSSI(dB),RxBt(V),Curr(A),VFAS(V),Thr'];
  for (let second = 0; second < 60; second += 1) {
    const flying = second >= 5 && second < 50;
    const amps = flying ? 12 + (second % 5 === 0 ? 8 : 0) : 0;
    const volts = flying ? 12.2 - second * 0.06 - (second % 5 === 0 ? 0.3 : 0) : second < 5 ? 12.5 : 10.4;
    const throttle = second >= 5 ? 700 : -1024;
    lines.push(
      `2023-05-03,12:48:${String(second).padStart(2, '0')}.100,${flying ? 80 : 100},5.0,${amps},${volts.toFixed(2)},${throttle}`,
    );
  }
  return lines.join('\n');
}

describe('readDay', () => {
  it('reads ISO days, European days and spreadsheet day numbers', () => {
    expect(readDay('2023-05-03')).toBe('2023-05-03');
    expect(readDay('03/05/2023')).toBe('2023-05-03');
    expect(readDay(44538)).toBe('2021-12-08');
    expect(readDay(2021)).toBeNull();
  });
});

describe('readTelemetry', () => {
  it('sums up an EdgeTX log', () => {
    const read = readTelemetry(parseCsv(edgeTxLog()), 'M2 EVO-2023-05-03-124800.csv');
    expect(read).not.toBeNull();
    expect(read!.log.start).toBe('2023-05-03T12:48:00');
    expect(read!.log.duration).toBe(59);
    expect(read!.log.maxCurrent).toBe(20);
    expect(read!.log.mAh).toBeGreaterThan(150);
    expect(read!.series.channels.throttle[10]).toBe(84);
  });

  it('finds the session of the log, on the heli named like the model', () => {
    const read = readTelemetry(parseCsv(edgeTxLog()), 'M2 EVO-2023-05-03-124800.csv')!;
    const base = {
      packs: 3,
      timer: 280,
      crashes: 0,
      broken: [],
      skills: [],
      notes: '',
      links: [],
      telemetry: [],
      loggedAt: '',
    };
    const sessions: Session[] = [
      {...base, id: 'a', date: '2023-05-03', heliId: 'm1'},
      {...base, id: 'b', date: '2023-05-03', heliId: 'm2'},
    ];
    const names: Record<string, string> = {m1: 'M1', m2: 'M2 EVO 🟠'};
    expect(modelFromFileName('M2 EVO-2023-05-03-124800.csv')).toBe('M2 EVO');
    expect(matchSession(read.log, 'M2 EVO', sessions, id => names[id])?.id).toBe('b');
    expect(matchSession(read.log, 'M4', sessions, id => names[id])).toBeNull();
  });
});

describe('telemetryInsights', () => {
  it('sees the pack run flat and the ESC cut the motor', () => {
    const read = readTelemetry(parseCsv(edgeTxLog()), 'log.csv')!;
    const insights = telemetryInsights(read.log, read.series, {cells: 3, capacity: 150});
    const texts = insights.map(insight => insight.text).join('\n');
    expect(texts).toContain('Power cut at 0:45 with the throttle still up');
    expect(texts).toMatch(/mAh used from a 150 mAh pack/);
    expect(insights.find(insight => insight.icon === '📉')?.tone).toBe('critical');
  });

  it('reads a pack from the hangar or from the heli line', () => {
    const heli = {id: 'h', name: 'M2', color: 0, status: 'active' as const, createdAt: '', battery: '3S 750 mAh'};
    expect(packOf(heli, [])).toEqual({cells: 3, capacity: 750});
    expect(packOf(heli, [{id: 'b', name: 'Big', cells: 6, capacity: 1300, count: 2, heliIds: ['h']}])).toEqual({
      cells: 6,
      capacity: 1300,
    });
    expect(estimateCells(12.56)).toBe(3);
    expect(estimateCells(22.2)).toBe(6);
  });
});
