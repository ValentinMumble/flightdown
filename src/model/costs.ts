/**
 * What the flying costs: the parts the crashes broke (priced from the spares of the same heli or the same model), and
 * each heli's cost an hour in the air, its price and its parts over its time flown.
 */
import type {Heli, Sortie, Spare} from '../types';
import {partKey, WHOLE_HELI} from './parts';
import {airtime} from './stats';

/** Two helis take the same parts when they are one, or the same model of the same maker. */
const sameModel = (left: Heli | undefined, right: Heli | undefined) =>
  !!left &&
  !!right &&
  (left.id === right.id || (!!left.model && left.model === right.model && left.maker === right.maker));

/** A broken part's price: the spare of that name for its heli, else for the same model, else one that fits any heli. */
export function partPrice(part: string, heli: Heli | undefined, spares: Spare[], helis: Heli[]): number | undefined {
  const key = partKey(part);
  const named = spares.filter(spare => spare.price !== undefined && partKey(spare.name) === key);
  const fits = (spare: Spare) => spare.heliId === heli?.id;
  const sameKind = (spare: Spare) =>
    !!spare.heliId &&
    sameModel(
      heli,
      helis.find(one => one.id === spare.heliId),
    );
  return (named.find(fits) ?? named.find(sameKind) ?? named.find(spare => !spare.heliId))?.price;
}

export interface HeliCost {
  heli: Heli;
  /** Seconds in the air. */
  airtime: number;
  /** Parts broken on it, and what the priced ones cost. */
  parts: number;
  partsCost: number;
  /** Its price and its priced parts an hour in the air; null when its price or its time is not known. */
  perHour: number | null;
}

export interface Costs {
  /** Parts broken, those with a price, and what they cost. */
  parts: number;
  pricedParts: number;
  partsCost: number;
  /** Crashes, and the parts cost of each (priced parts only); null with no crash. */
  crashes: number;
  perCrash: number | null;
  /** By heli, the most flown first. */
  byHeli: HeliCost[];
  /** The parts with no price, the most broken first: a spare with a price counts them. */
  unpriced: {name: string; qty: number}[];
}

/** What the sorties given broke and cost, each of their helis' price and parts over its time in them. */
export function costs(sorties: Sortie[], helis: Heli[], spares: Spare[]): Costs {
  const result: Costs = {
    parts: 0,
    pricedParts: 0,
    partsCost: 0,
    crashes: 0,
    perCrash: null,
    byHeli: [],
    unpriced: [],
  };
  const byHeli = new Map<string, HeliCost>();
  const unpriced = new Map<string, {name: string; qty: number}>();
  for (const sortie of sorties) {
    const heli = helis.find(one => one.id === sortie.heliId);
    result.crashes += sortie.crashes ?? 0;
    const tally = heli && (byHeli.get(heli.id) ?? {heli, airtime: 0, parts: 0, partsCost: 0, perHour: null});
    if (tally) {
      tally.airtime += airtime(sortie);
      byHeli.set(tally.heli.id, tally);
    }
    for (const broken of sortie.broken) {
      if (broken.part === WHOLE_HELI) continue;
      result.parts += broken.qty;
      if (tally) tally.parts += broken.qty;
      const price = partPrice(broken.part, heli, spares, helis);
      if (price === undefined) {
        const key = partKey(broken.part);
        const kept = unpriced.get(key) ?? {name: broken.part, qty: 0};
        kept.qty += broken.qty;
        unpriced.set(key, kept);
        continue;
      }
      result.pricedParts += broken.qty;
      result.partsCost += price * broken.qty;
      if (tally) tally.partsCost += price * broken.qty;
    }
  }
  result.perCrash = result.crashes ? result.partsCost / result.crashes : null;
  result.byHeli = [...byHeli.values()]
    .map(tally => ({
      ...tally,
      perHour:
        tally.heli.price !== undefined && tally.airtime > 0
          ? (tally.heli.price + tally.partsCost) / (tally.airtime / 3600)
          : null,
    }))
    .sort((left, right) => right.airtime - left.airtime);
  result.unpriced = [...unpriced.values()].sort((left, right) => right.qty - left.qty);
  return result;
}
