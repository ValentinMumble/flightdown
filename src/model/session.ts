import type {Sortie, TelemetrySeries} from '../types';
import type {Position} from '../radio/roles';
import {exceedances} from './cockpit';

/** From this current the motor is working: the head spinning, in the air or just landed. */
const IN_FLIGHT_AMPS = 4;
/**
 * A hold undone within this many seconds was flipped in flight (a slip, or an autorotation tried): one left on is the
 * landing, the hold flipped as the skids touch with the head still spinning.
 */
const BACK_SECONDS = 30;

/** The latest sortie with radio logs: the session the Cockpit sums up. */
export function lastSession(sorties: Sortie[]): Sortie | null {
  return [...sorties].reverse().find(sortie => sortie.telemetry.length > 0) ?? null;
}

/** A moment of a session worth knowing, at its time of day. */
export interface SessionEvent {
  /** Seconds into the pack. */
  at: number;
  text: string;
  tone: 'caution' | 'warning';
}

/**
 * The moments throttle hold went on in flight: the hold switch (SF, as the log keeps it: -1 up, 1 down) left the
 * position it runs the motor in while the pack drew IN_FLIGHT_AMPS or more, and came back to it within BACK_SECONDS.
 */
export function holdsInFlight(series: TelemetrySeries, running: Position = 'up') {
  const hold = series.channels.sf ?? [];
  const current = series.channels.current ?? [];
  const runs = running === 'up' ? -1 : running === 'down' ? 1 : 0;
  // A long log is thinned by averaging samples: a switch reads where it mostly was.
  const at = (index: number) => Math.round(hold[index]);
  const found: {at: number; amps: number; back: number}[] = [];
  for (let index = 1; index < hold.length; index += 1) {
    if (at(index - 1) !== runs || at(index) === runs || (current[index - 1] ?? 0) < IN_FLIGHT_AMPS) continue;
    const again = hold.findIndex((_value, later) => later > index && at(later) === runs);
    const back = again > 0 ? series.time[again] - series.time[index] : null;
    if (back === null || back > BACK_SECONDS) continue;
    found.push({at: series.time[index], amps: current[index - 1], back});
  }
  return found;
}

/**
 * What a pack's samples tell beyond its summary: a throttle hold flipped in flight, the link lost while flying, and a
 * hard stop (a strike, likely a crash). Cell sags, deep drains and current past the rating are in the pack's notes.
 */
export function packEvents(series: TelemetrySeries, running: Position = 'up'): SessionEvent[] {
  const holds = holdsInFlight(series, running).map((hold): SessionEvent => ({
    at: hold.at,
    text: `throttle hold at ${hold.amps.toFixed(0)} A, back on after ${Math.max(1, Math.round(hold.back))} s`,
    tone: 'warning',
  }));
  const others = exceedances(series)
    .filter(found => found.kind === 'link' || found.kind === 'strike')
    .map((found): SessionEvent => ({
      at: found.start,
      text: found.text,
      tone: found.kind === 'strike' ? 'warning' : 'caution',
    }));
  return [...holds, ...others].sort((left, right) => left.at - right.at);
}

/** The time of day a moment of a pack fell at ("16:34"), from the pack's start ("2026-11-20T16:32:08"). */
export function clockAt(start: string | undefined, second: number): string {
  const match = /T(\d{2}):(\d{2}):(\d{2})/.exec(start ?? '');
  if (!match) return '';
  const total = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Math.round(second);
  const hours = Math.floor(total / 3600) % 24;
  const minutes = Math.floor((total % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** When a session's last log ended, as a moment (the logs keep local time). */
export function sessionEnd(sortie: Sortie): Date | null {
  const ends = sortie.telemetry.flatMap(log =>
    log.start ? [new Date(log.start).getTime() + log.duration * 1000] : [],
  );
  return ends.length ? new Date(Math.max(...ends)) : null;
}
