import {Vector3} from 'three';

/**
 * The wind at a moment (m/s, a vector), from the pilot's left: its mean, gusting up to `gusts` (both km/h) and down as
 * far below, veering a little. A replay flies in its sortie's recorded wind (Open-Meteo's, at 10 m); the sim's own
 * setting gusts a third either way.
 */
export function windAt(time: number, wind: number, gusts = wind * 1.35, into = new Vector3()): Vector3 {
  const swing = wind > 0 ? Math.min(0.9, Math.max(0, gusts / wind - 1)) : 0;
  const blowing = (wind / 3.6) * (1 + swing * Math.sin(time * 0.7) * Math.sin(time * 0.23 + 1));
  const veer = 0.25 * Math.sin(time * 0.11);
  return into.set(Math.cos(veer), 0, Math.sin(veer)).multiplyScalar(blowing);
}
