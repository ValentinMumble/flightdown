/**
 * A logged pack replayed in the sim: what the radio sent (CH1 to CH6, logged in µs) read as the sim reads the radio,
 * through the model's reversals, with the rescue (SH) and self-level (SC) as logged. Shown beside the pilot's sticks,
 * or flying the heli: open loop, so the sim heli drifts from the real one within seconds, the pilot's corrections
 * having answered the real heli's moves.
 */
import type {TelemetrySeries} from '../types';
import {activeSpan, sampleAt} from '../model/telemetry';
import type {Controls} from './physics';
import {readAxes, type Mapping} from './input';

export type ReplayMode = 'sticks' | 'fly';

export interface Replay {
  series: TelemetrySeries;
  mode: ReplayMode;
  /** Its flips and rolls (the stand-in pilot keeps out of them) and its motor cuts (its landings). */
  stretches: {from: number; to: number}[];
  cuts: number[];
  /** What it is called, for the banner over the view. */
  label: string;
  /** When it was started (performance.now), and the log's second it started from. */
  startedAt: number;
  from: number;
}

/** Where a replay starts in its log: a couple of seconds before the motor first runs, else at its start. */
export const replayStart = (series: TelemetrySeries) => activeSpan(series)?.from ?? series.time[0] ?? 0;

/** The log's last second. */
export const replayEnd = (series: TelemetrySeries) => series.time[series.time.length - 1] ?? 0;

/** The outputs logged at a second, -1 to 1 as the radio sends them (from µs, 1500 the centre); 0 where none. */
export function loggedOutputs(series: TelemetrySeries, second: number): number[] {
  return Array.from({length: 8}, (_, index) => {
    const value = sampleAt(series.time, series.channels[`ch${index + 1}`], second);
    return value === null ? 0 : Math.max(-1, Math.min(1, (value - 1500) / 512));
  });
}

/** What the log flew at a second, as the sim's controls: its outputs read through `mapping`, its rescue and level. */
export function loggedControls(series: TelemetrySeries, second: number, mapping: Mapping): Controls {
  const switchDown = (name: string) => (sampleAt(series.time, series.channels[name], second) ?? -1) >= 1;
  return {
    ...readAxes(loggedOutputs(series, second), mapping),
    rescue: switchDown('sh'),
    level: switchDown('sc'),
  };
}

/** The sticks logged at a second (-1 to 1, the throttle stick as the collective), for the radio screen. */
export function loggedSticks(series: TelemetrySeries, second: number): Controls {
  const at = (name: string) => (sampleAt(series.time, series.channels[name], second) ?? 0) / 100;
  return {
    roll: at('aileron'),
    pitch: at('elevator'),
    yaw: at('rudder'),
    collective: at('throttle') * 2 - 1,
    throttle: 0,
  };
}
