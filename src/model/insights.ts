import type {Battery, Heli, TelemetryLog, TelemetrySeries} from '../types';
import {formatNumber, formatTimer} from './format';

export interface Insight {
  tone: 'good' | 'warning' | 'critical' | 'info';
  icon: string;
  text: string;
}

/** Below this current the motor is idle: on the ground, or in throttle hold. */
const IDLE_AMPS = 2;

/** A LiPo pack's cell count from its highest voltage: no cell sits above 4.25 V. */
export const estimateCells = (maxVoltage: number) => Math.max(1, Math.ceil(maxVoltage / 4.25));

/** The pack a heli flies on: from its packs in the hangar, else from its "3S 750 mAh" line. */
export function packOf(heli: Heli | undefined, batteries: Battery[]): {cells?: number; capacity?: number} {
  const battery = heli ? batteries.find(one => one.heliIds.includes(heli.id)) : undefined;
  if (battery) return {cells: battery.cells, capacity: battery.capacity};
  const text = heli?.battery ?? '';
  const cells = /(\d{1,2})\s*S\b/i.exec(text)?.[1];
  const capacity = /(\d{3,5})\s*mAh/i.exec(text)?.[1];
  return {...(cells && {cells: Number(cells)}), ...(capacity && {capacity: Number(capacity)})};
}

/**
 * What a log says, in words: did the pack run flat, how far was it drained, how low did each cell sag, when was 80 %
 * of it used (a good timer for flying like that), how the radio link held.
 */
export function telemetryInsights(
  log: TelemetryLog,
  series: TelemetrySeries,
  pack: {cells?: number; capacity?: number} = {},
): Insight[] {
  const insights: Insight[] = [];
  const {time} = series;
  const voltage = series.channels.voltage ?? [];
  const current = series.channels.current ?? [];
  const throttle = series.channels.throttle ?? [];
  const rssi = series.channels.rssi ?? [];
  // A heli spooled up on the bench draws a few amps at most; flying takes more.
  if (!current.length || Math.max(...current) < IDLE_AMPS * 2) {
    insights.push({tone: 'info', icon: '🔌', text: 'No power drawn: a check on the bench, not a flight.'});
    return insights;
  }

  const cells = pack.cells ?? (voltage.length ? estimateCells(Math.max(...voltage)) : undefined);
  const flying = current.map(amps => amps >= IDLE_AMPS);
  const first = flying.indexOf(true);
  const last = flying.lastIndexOf(true);
  const at = (index: number) => formatTimer(time[index] - time[first]);
  // A log switched on or off in the air holds only part of the pack.
  const startsFlying = current[0] >= IDLE_AMPS;
  const endsFlying = current[current.length - 1] >= IDLE_AMPS * 2;

  // The ESC cutting power while the throttle is still up, on a sagging pack: it ran flat.
  if (voltage.length && throttle.length && cells) {
    for (let index = first + 1; index < current.length; index += 1) {
      // The current can fade over a couple of samples as the ESC gives up.
      const wasFlying = Math.max(...current.slice(Math.max(0, index - 3), index)) >= IDLE_AMPS;
      const cut = current[index] < 1 && wasFlying && throttle[index] > 60;
      const low = Math.min(...voltage.slice(Math.max(0, index - 5), index + 1)) / cells < 3.3;
      if (cut && low) {
        insights.push({
          tone: 'critical',
          icon: '🪫',
          text: `Power cut at ${at(index)} with the throttle still up: the pack ran flat and the ESC stopped the motor.`,
        });
        break;
      }
    }
  }

  // How far the pack was drained.
  const used = log.mAh;
  if (used !== undefined && pack.capacity) {
    const share = used / pack.capacity;
    const percent = Math.round(share * 100);
    if (startsFlying || endsFlying) {
      insights.push({tone: 'info', icon: '🔋', text: `${percent} % of the pack used while logging.`});
    } else if (share >= 1) {
      insights.push({
        tone: 'critical',
        icon: '⚠️',
        text: `${formatNumber(used)} mAh used from a ${formatNumber(pack.capacity)} mAh pack (${percent} %): over-discharged, check it for puffing.`,
      });
    } else if (share > 0.85) {
      insights.push({
        tone: 'warning',
        icon: '🔋',
        text: `Landed with ${100 - percent} % left: below the 20 % that keeps a LiPo healthy.`,
      });
    } else {
      insights.push({tone: 'good', icon: '🔋', text: `Landed with ${100 - percent} % left in the pack.`});
    }
  }

  // When 80 % was used: the timer to set for flying like this.
  if (pack.capacity && current.length > 2) {
    let drawn = 0;
    for (let index = 1; index < current.length; index += 1) {
      drawn += ((current[index] + current[index - 1]) / 2) * ((time[index] - time[index - 1]) / 3600) * 1000;
      if (drawn >= pack.capacity * 0.8) {
        insights.push({
          tone: 'info',
          icon: '⏱️',
          text: `80 % of the pack was used ${at(index)} into the flight: a timer at ${at(index)} lands with a healthy reserve when flying like this.`,
        });
        break;
      }
    }
  }

  // Voltage sag under load, a cell at a time.
  if (voltage.length && cells) {
    let lowest = Infinity;
    let lowestAt = first;
    for (let index = first; index <= last; index += 1) {
      if (current[index] >= IDLE_AMPS && voltage[index] > 0.5 && voltage[index] < lowest) {
        lowest = voltage[index];
        lowestAt = index;
      }
    }
    const perCell = lowest / cells;
    if (Number.isFinite(perCell)) {
      const text = `Lowest ${formatNumber(perCell, 2)} V a cell under load (${formatNumber(lowest, 2)} V on ${cells}S) at ${at(lowestAt)}`;
      if (perCell < 3.3)
        insights.push({tone: 'critical', icon: '📉', text: `${text}: far below the 3.5 V to land at.`});
      else if (perCell < 3.5) insights.push({tone: 'warning', icon: '📉', text: `${text}: land a little sooner.`});
      else insights.push({tone: 'good', icon: '📈', text: `${text}: the pack held up well.`});
    }
  }

  // Pack resistance from the voltage drop at each sharp rise in current: it climbs as a pack ages.
  if (voltage.length && cells) {
    const drops: number[] = [];
    for (let index = 1; index < current.length; index += 1) {
      const rise = current[index] - current[index - 1];
      if (rise > 6) drops.push((voltage[index - 1] - voltage[index]) / rise);
    }
    if (drops.length >= 3) {
      const sorted = drops.sort((left, right) => left - right);
      const resistance = sorted[Math.floor(sorted.length / 2)] * 1000;
      if (resistance > 0) {
        insights.push({
          tone: 'info',
          icon: '🔬',
          text: `Pack resistance about ${Math.round(resistance)} mΩ (${Math.round(resistance / cells)} mΩ a cell): watch it rise as the pack ages.`,
        });
      }
    }
  }

  // The radio link, while flying (FrSky-style RSSI: EdgeTX warns at 45 dB, gives up at 42).
  const flyingRssi = rssi.filter((value, index) => flying[index] && value > 0);
  if (flyingRssi.length) {
    const weakest = Math.min(...flyingRssi);
    if (weakest < 45)
      insights.push({
        tone: 'warning',
        icon: '📡',
        text: `Signal fell to ${weakest} dB in flight: below EdgeTX's 45 dB warning.`,
      });
    else insights.push({tone: 'good', icon: '📡', text: `Signal stayed strong in flight (lowest ${weakest} dB).`});
  }

  if (startsFlying) {
    insights.push({tone: 'info', icon: '✂️', text: 'The log starts mid-flight: logging was switched on in the air.'});
  }
  if (endsFlying) {
    insights.push({
      tone: 'info',
      icon: '✂️',
      text: 'The log stops mid-flight: logging was switched off before landing.',
    });
  }
  return insights;
}
