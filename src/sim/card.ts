import {useEffect, useState} from 'react';
import type {Card} from '../radio/card';

/** The radio's card (every model and widget, from edge-tx), read once a visit for the sim and its radio screen. */
let reading: Promise<Card | null> | null = null;

export function readCard() {
  reading ??= fetch('/api/radio')
    .then(async response => (response.ok ? ((await response.json()) as Card) : null))
    .catch(() => null);
  return reading;
}

/** The radio's card, once read: null until then, or when it cannot be. */
export function useCard() {
  const [card, setCard] = useState<Card | null>(null);
  useEffect(() => {
    let current = true;
    void readCard().then(found => current && setCard(found));
    return () => {
      current = false;
    };
  }, []);
  return card;
}
