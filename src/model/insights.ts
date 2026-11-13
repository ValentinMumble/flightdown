import type {Battery, Heli, TelemetryLog, TelemetrySeries, TurnWay} from '../types';
import {formatNumber, formatTimer} from './format';

export interface Insight {
  tone: 'good' | 'warning' | 'critical' | 'info';
  icon: string;
  text: string;
}

/** Below this current the motor is idle: on the ground, or in throttle hold. */
const IDLE_AMPS = 2;

/** Held at least this long, the pitch past the other side of hover under load is inverted flight. */
const INVERTED_SECONDS = 3;
/** How far to the other side of hover: a quarter of the collective's travel (-3° on a ±12° heli). */
const INVERTED_SHARE = 0.25;

/**
 * Each time the collective (CH6, logged in µs, 512 each way of 1500) went well to the other side of hover, the motor
 * under load, as sample indexes: from the first sample there to the first one back (or the log's end). Upright the heli
 * hovers with the pitch to one side of centre (the side of most of its time under load, whatever the channel's
 * reversal); past a quarter of the travel the other side, it is on its back, or diving.
 */
function otherSidePasses(series: TelemetrySeries): {from: number; to: number}[] {
  const pitch = series.channels.ch6 ?? [];
  const current = series.channels.current ?? [];
  if (!pitch.length || !current.length) return [];
  const loaded = pitch.map((_, index) => (current[index] ?? 0) >= IDLE_AMPS);
  const sides = pitch.filter((_, index) => loaded[index]).map(value => value - 1500);
  if (!sides.length) return [];
  const hover = sides.sort((left, right) => left - right)[Math.floor(sides.length / 2)];
  if (hover === 0) return [];
  const upright = Math.sign(hover);
  const passes: {from: number; to: number}[] = [];
  let from = -1;
  for (let index = 0; index <= pitch.length; index += 1) {
    const over = index < pitch.length && loaded[index] && -upright * (pitch[index] - 1500) >= 512 * INVERTED_SHARE;
    if (over && from < 0) from = index;
    if (!over && from >= 0) {
      passes.push({from, to: index});
      from = -1;
    }
  }
  return passes;
}

/**
 * When the heli flew upside down: the pitch held to the other side of hover (see otherSidePasses) for 3 s or more.
 * Upright it would fall: flips, rolls and dives pass through that pitch quicker. Each stretch's start and length, in
 * seconds.
 */
export function invertedStretches(series: TelemetrySeries): {start: number; seconds: number}[] {
  const {time} = series;
  return otherSidePasses(series).flatMap(({from, to}) => {
    // Until the next sample, when it was upright again (or the log's end).
    const seconds = time[Math.min(to, time.length - 1)] - time[from];
    return seconds >= INVERTED_SECONDS ? [{start: time[from], seconds}] : [];
  });
}

/** Cyclic (% of the stick) under which it says nothing of a turn over's way: no flip without the stick pushed. */
const FLIP_STICK = 15;
/** Seconds either side of a moment whose cyclic says which way the heli went over. */
const FLIP_WINDOW = 0.4;

/** The way the cyclic took the heli over around a sample: the stick held most, or null when too faint to say. */
function wayAround(series: TelemetrySeries, index: number): TurnWay | null {
  const {time, channels} = series;
  const aileron = channels.aileron ?? [];
  const elevator = channels.elevator ?? [];
  let rolled = 0;
  let pitched = 0;
  let count = 0;
  for (let at = 0; at < time.length; at += 1) {
    // A hair over: logged times are not exact (59.4 can read 59.40000001), and a sample left out tips the mean.
    if (Math.abs(time[at] - time[index]) > FLIP_WINDOW + 0.001) continue;
    rolled += aileron[at] ?? 0;
    pitched += elevator[at] ?? 0;
    count += 1;
  }
  rolled /= count || 1;
  pitched /= count || 1;
  if (Math.max(Math.abs(rolled), Math.abs(pitched)) < FLIP_STICK) return null;
  if (Math.abs(rolled) >= Math.abs(pitched)) return rolled > 0 ? 'right' : 'left';
  return pitched > 0 ? 'front' : 'back';
}

/**
 * Every time the heli turned over onto its back and upright again: each pass of the pitch to the other side of hover
 * (see otherSidePasses, any length), with the way it went over and the way it came back, read from the cyclic around
 * each end (the elevator back, a back flip; the aileron right, a roll right). A pass with no cyclic going over is a
 * dive or a pitch pump, not a flip: left out. Too faint a stick coming back means it went on round the same way.
 */
export function turnOvers(series: TelemetrySeries): {start: number; end: number; going: TurnWay; coming: TurnWay}[] {
  const {time} = series;
  return otherSidePasses(series).flatMap(({from, to}) => {
    const going = wayAround(series, from);
    if (!going) return [];
    const coming = wayAround(series, Math.max(from, to - 1)) ?? going;
    return [{start: time[from], end: time[Math.min(to, time.length - 1)], going, coming}];
  });
}

/**
 * Whole flips and rolls: over and back round the same way is one (a back flip onto its back, held a while, then on
 * round upright is one back flip); over one way and back the other is no whole turn.
 */
export function flipCounts(series: TelemetrySeries): Partial<Record<TurnWay, number>> {
  const counts: Partial<Record<TurnWay, number>> = {};
  for (const turn of turnOvers(series)) {
    if (turn.going === turn.coming) counts[turn.going] = (counts[turn.going] ?? 0) + 1;
  }
  return counts;
}

const FLIP_WORDS: Record<TurnWay, [string, string]> = {
  back: ['back flip', 'back flips'],
  front: ['front flip', 'front flips'],
  left: ['roll left', 'rolls left'],
  right: ['roll right', 'rolls right'],
};

/** Flip counts in words, "10 back flips, 1 front flip, 2 rolls left", or null when there are none. */
export function describeFlips(counts: Partial<Record<TurnWay, number>> | undefined): string | null {
  const parts = (['back', 'front', 'left', 'right'] as TurnWay[]).flatMap(way => {
    const count = counts?.[way] ?? 0;
    return count ? [`${count} ${FLIP_WORDS[way][count === 1 ? 0 : 1]}`] : [];
  });
  return parts.length ? parts.join(', ') : null;
}

/** Two logs' flip counts added up. */
export function addFlips(
  left: Partial<Record<TurnWay, number>> = {},
  right: Partial<Record<TurnWay, number>> = {},
): Partial<Record<TurnWay, number>> {
  const sum: Partial<Record<TurnWay, number>> = {...left};
  for (const [way, count] of Object.entries(right) as [TurnWay, number][]) sum[way] = (sum[way] ?? 0) + count;
  return sum;
}

/**
 * A pack's resistance (mΩ, the whole pack) from the voltage drop at each sharp rise in current (more than 6 A from one
 * sample to the next): the median of three or more, else null. It climbs as a pack ages.
 */
export function packResistance(series: TelemetrySeries): number | null {
  const voltage = series.channels.voltage ?? [];
  const current = series.channels.current ?? [];
  if (!voltage.length) return null;
  const drops: number[] = [];
  for (let index = 1; index < current.length; index += 1) {
    const rise = current[index] - current[index - 1];
    if (rise > 6) drops.push((voltage[index - 1] - voltage[index]) / rise);
  }
  if (drops.length < 3) return null;
  const resistance = drops.sort((left, right) => left - right)[Math.floor(drops.length / 2)] * 1000;
  return resistance > 0 ? resistance : null;
}

/** A LiPo pack's cell count from its highest voltage: no cell sits above 4.25 V. */
export const estimateCells = (maxVoltage: number) => Math.max(1, Math.ceil(maxVoltage / 4.25));

/** The pack a heli flies on: from its packs in the hangar, else from its "3S 750 mAh" line. */
/**
 * A heli's pack: the kind it has most live packs of in the Hangar (the bigger one on a tie), or what its battery note
 * says.
 */
export function packOf(heli: Heli | undefined, batteries: Battery[]): {cells?: number; capacity?: number} {
  const live = (battery: Battery) => battery.packs.filter(pack => !pack.dead).length;
  const battery = heli
    ? batteries
        .filter(one => one.heliIds.includes(heli.id))
        .sort((left, right) => live(right) - live(left) || right.capacity - left.capacity)[0]
    : undefined;
  if (battery) return {cells: battery.cells, capacity: battery.capacity};
  const text = heli?.battery ?? '';
  const cells = /(\d{1,2})\s*S\b/i.exec(text)?.[1];
  const capacity = /(\d{3,5})\s*mAh/i.exec(text)?.[1];
  return {...(cells && {cells: Number(cells)}), ...(capacity && {capacity: Number(capacity)})};
}

/**
 * What a log says, in words: did the pack run flat, how far was it drained, how low did each cell sag, when was 80 %
 * of it used (a good timer for flying like that), how the radio link held, how long it flew upside down.
 */
export function telemetryInsights(
  log: Pick<TelemetryLog, 'mAh'>,
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
  const resistance = packResistance(series);
  if (resistance !== null && cells) {
    insights.push({
      tone: 'info',
      icon: '🔬',
      text: `Pack resistance about ${Math.round(resistance)} mΩ (${Math.round(resistance / cells)} mΩ a cell): watch it rise as the pack ages.`,
    });
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
  }

  // Upside down, from the collective held past the other side of hover.
  const inverted = invertedStretches(series);
  if (inverted.length) {
    const total = Math.round(inverted.reduce((sum, stretch) => sum + stretch.seconds, 0));
    const longest = Math.round(Math.max(...inverted.map(stretch => stretch.seconds)));
    const times = inverted.length === 1 ? 'once' : `${inverted.length} times`;
    insights.push({
      tone: 'good',
      icon: '🙃',
      text: `Inverted ${times}: ${total} s in all, the longest ${longest} s (the pitch held past the other side of hover).`,
    });
  }

  // Whole flips and rolls, from the turns over and the cyclic through them.
  const flips = describeFlips(flipCounts(series));
  if (flips) {
    insights.push({
      tone: 'good',
      icon: '🔄',
      text: `${flips[0].toUpperCase()}${flips.slice(1)} (whole turns: over onto its back and on round the same way).`,
    });
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
