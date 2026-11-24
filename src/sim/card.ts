import {useEffect, useState} from 'react';
import type {Card} from '../radio/card';
import {call, isOffline, readAnswer} from '../data/http';
import {keep, readKept} from '../data/deviceCache';

/** The radio's card as last read, kept on the device for the field. */
const KEPT_CARD = 'radio:card';

export interface CardRead {
  card: Card | null;
  /** Why it is the copy kept on the device, or missing: none when it was read now. */
  problem: string | null;
}

/** Reads the radio's card (every model and widget, from edge-tx), else the copy kept on the device. */
async function load(): Promise<CardRead> {
  try {
    const response = await call('/api/radio', {cache: 'no-store'});
    if (!response.ok) throw new Error(`The radio card could not be read (the server answered ${response.status})`);
    const card = await readAnswer<Card>(response);
    void keep(KEPT_CARD, card);
    return {card, problem: null};
  } catch (error) {
    const kept = await readKept<Card>(KEPT_CARD);
    const why = isOffline(error) ? 'No connection to Flightdown' : String((error as Error).message ?? error);
    return {
      card: kept,
      problem: kept ? `${why}: the radio card as last read` : `${why}: the radio card could not be read`,
    };
  }
}

let reading: Promise<CardRead> | null = null;

/** The card, read once a visit for the sim and its radio screen; `fresh` reads it again (the Radio tab). */
export function readCard(fresh = false) {
  if (fresh || !reading) reading = load();
  return reading;
}

/** The radio's card, once read: null until then, or when it cannot be. */
export function useCard() {
  const [card, setCard] = useState<Card | null>(null);
  useEffect(() => {
    let current = true;
    void readCard().then(found => current && setCard(found.card));
    return () => {
      current = false;
    };
  }, []);
  return card;
}
