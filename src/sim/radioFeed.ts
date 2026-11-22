/**
 * What the TX16S's screen shows in the sim: its widgets (the Cockpit and the top bar's) read the sticks, switches,
 * outputs and telemetry from the sim's flight, as the radio would on the field. The pack is simulated too: its charge,
 * the current the rotor's load draws (sized from the M2 EVO's logs: about 4, 7 and 12 A in its three idle ups), and
 * its voltage sagging under it.
 */
import type {Battery, Heli} from '../types';
import type {Controls} from './physics';
import {isLowered} from './input';
import {outputIndex} from '../radio/mixer';

export interface SimFeed {
  controls: Controls;
  /** The radio's own outputs (CH1 on), -1 to 1, when the radio is the controller: its mixes already done. */
  outputs: number[];
  /** The idle up (1 to 3) flown, and whether the motor runs. */
  idleUp: number;
  motor: boolean;
  /** The rescue held (SH). */
  rescue: boolean;
  /** The pack: volts, amps drawn, mAh used, and the 6-position button it is picked with (1 to 6). */
  volts: number;
  amps: number;
  used: number;
  button: number;
}

export interface SimPack {
  cells: number;
  /** mAh */
  capacity: number;
  /** The button it is picked with on the radio, so the Cockpit names it. */
  button: number;
}

/** The pack a heli flies: its kind's first live pack with a button, else what its battery says ("1S 450 mAh"). */
export function packFor(heli: Heli | undefined, batteries: Battery[]): SimPack {
  for (const battery of batteries) {
    if (!heli || !battery.heliIds.includes(heli.id)) continue;
    const pack = battery.packs.find(one => !one.dead && one.button);
    if (pack?.button) return {cells: battery.cells, capacity: battery.capacity, button: pack.button};
  }
  const said = /(\d)S\s*(\d+)\s*mAh/i.exec(heli?.battery ?? '');
  return said ? {cells: Number(said[1]), capacity: Number(said[2]), button: 1} : {cells: 3, capacity: 750, button: 1};
}

/** A LiPo cell's resting volts by its charge (0 to 1). */
const CHARGE_CURVE = [
  [0, 3.3],
  [0.05, 3.55],
  [0.1, 3.65],
  [0.2, 3.72],
  [0.4, 3.79],
  [0.6, 3.86],
  [0.8, 4.0],
  [1, 4.2],
];

export function restingVolts(cells: number, charge: number) {
  const level = Math.max(0, Math.min(1, charge));
  const above = CHARGE_CURVE.findIndex(([at]) => at >= level);
  if (above <= 0) return cells * CHARGE_CURVE[0][1];
  const [fromAt, fromVolts] = CHARGE_CURVE[above - 1];
  const [toAt, toVolts] = CHARGE_CURVE[above];
  return cells * (fromVolts + ((toVolts - fromVolts) * (level - fromAt)) / (toAt - fromAt));
}

/** A cell's resistance, Ω: a pack in good shape (the logs read 25 to 100 mΩ for the M2 EVO's 3S packs). */
const CELL_RESISTANCE = 0.02;

/** The pack's volts with `used` mAh gone and `amps` drawn. */
export const packVolts = (pack: SimPack, used: number, amps: number) =>
  restingVolts(pack.cells, 1 - used / pack.capacity) - amps * CELL_RESISTANCE * pack.cells;

/**
 * The current drawn, fitted to the M2 EVO's November 2026 logs (13,000 samples flying): a steady 3.4 A (receiver,
 * FBL, tail motor), the blades' drag growing with head speed cubed, a little more with pitch either way (inverted
 * too), in proportion to the heli's weight. 7 A hovering in idle up 2, about 10 A in idle up 3. Nothing with the
 * motor off. `headSpeed` against hover's, `pitch` the collective's share of the most (-1 to 1).
 */
export function drawAmps(mass: number, pitch: number, headSpeed: number, motor: boolean) {
  if (!motor) return 0;
  return (mass / 0.345) * (3.37 + 3.36 * headSpeed ** 3 + 1.13 * headSpeed ** 2 * Math.abs(pitch));
}

/** The value of the button `button` (1 to 6) on the 6-position source, as the radio reads it. */
export const buttonValue = (button: number) => Math.round(-1024 + (button - 1) * 409.6);

const UP = -1024;
const MIDDLE = 0;
const DOWN = 1024;
const toRadio = (value: number) => Math.round(Math.max(-1, Math.min(1, value)) * 1024);

/**
 * A source, as a widget asks for it (getValue's name, a switch, an output CH1, a sensor, or tele(n)), from the feed.
 * The switches are set as flying it: armed (SA down), throttle hold off with the motor on (SF), the idle up on SE,
 * the rescue (SH) while held, self-level (SC) as set, the practice rates (SD) with lower rates picked. Outputs come from the radio itself when it is the controller; else from
 * the sticks, reversed as the model reverses them.
 */
export function simSource(
  asked: string,
  feed: SimFeed,
  model: {sensors?: string[]; reversed?: number[]} | null,
): number {
  const name = asked.trim();
  const telemetry = /^tele\([-+]?(\d+)\)$/.exec(name);
  if (telemetry) {
    const sensor = model?.sensors?.[Number(telemetry[1])];
    return sensor ? simSource(sensor, feed, model) : 0;
  }
  // An output: CH5 by its name, ch(4) as the card writes it (from 0), as the radio reads them.
  const index = outputIndex(name);
  if (index !== null) {
    if (feed.outputs.length) return toRadio(feed.outputs[index] ?? 0);
    const {roll, pitch, yaw, collective, throttle} = feed.controls;
    const sent = [roll, pitch, feed.motor ? throttle * 2 - 1 : -1, yaw, 0, collective][index] ?? 0;
    return toRadio(model?.reversed?.includes(index) ? -sent : sent);
  }
  switch (name.toLowerCase()) {
    case 'ail':
      return toRadio(feed.controls.roll);
    case 'ele':
      return toRadio(feed.controls.pitch);
    case 'rud':
      return toRadio(feed.controls.yaw);
    case 'thr':
      return toRadio(feed.controls.collective);
    case 'sa':
      return feed.controls.armed === false ? UP : DOWN;
    case 'sf':
      return (feed.controls.throttleOn ?? feed.motor) ? UP : DOWN;
    case 'se':
      return feed.idleUp === 1 ? UP : feed.idleUp === 2 ? MIDDLE : DOWN;
    case 'sh':
      return feed.rescue ? DOWN : UP;
    case 'sc':
      return feed.controls.level ? DOWN : UP;
    case 'sd':
      return isLowered(feed.controls.rates) ? DOWN : UP;
    case 'sb':
    case 'sg':
      return UP;
    case '6pos':
    case '6p':
    case 'p2':
      return buttonValue(feed.button);
    case 'vfas':
    case 'rxbt':
    case 'a1':
      return feed.volts;
    case 'curr':
      return feed.amps;
    case 'mah':
    case 'capa':
    case 'fuel':
      return feed.used;
    case 'rssi':
    case '1rss':
      return 85;
    case 'tqly':
    case 'rqly':
      return 100;
    case 'tx_voltage':
    case 'txbat':
      return 8.1;
    default:
      return 0;
  }
}

/** The idle up a throttle share is nearest to, on the M2 EVO's (54, 60 and 75 %). */
export function idleUpOf(throttle: number) {
  return throttle < 0.57 ? 1 : throttle < 0.68 ? 2 : 3;
}

export const emptyFeed = (): SimFeed => ({
  // Disarmed until the controller says otherwise: the radio screen starts SAFE.
  controls: {roll: 0, pitch: 0, yaw: 0, collective: 0, throttle: 0, armed: false},
  outputs: [],
  idleUp: 2,
  motor: false,
  rescue: false,
  volts: 12.6,
  amps: 0,
  used: 0,
  button: 1,
});
