import {useSyncExternalStore} from 'react';

/**
 * A value that changes many times a second (the sim's readings): kept outside React's state, so only the parts that
 * show it render again, each when what it picks from it changes.
 */
export interface Live<Value> {
  get: () => Value;
  set: (value: Value) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createLive<Value>(initial: Value): Live<Value> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: next => {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** What `pick` takes from a live value: a number, a string, or a part of it kept as it is (never a new object). */
export function useLive<Value, Picked>(live: Live<Value>, pick: (value: Value) => Picked): Picked {
  return useSyncExternalStore(live.subscribe, () => pick(live.get()));
}
