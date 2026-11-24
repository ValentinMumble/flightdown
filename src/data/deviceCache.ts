/**
 * What the app keeps on this device in IndexedDB, too big for localStorage: the owner's log as last read, every log's
 * samples once read (a sortie's packs, the Debrief, the sim's replays then work with no signal) and the radio's card.
 * Every call fails quietly: a private window, blocked storage or a full disk only means waiting for the network.
 */

const DATABASE = 'flightdown';
const STORE = 'kept';
const VERSION = 1;

let opening: Promise<IDBDatabase> | null = null;

const open = () =>
  (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => {
    opening = null;
    throw error;
  }));

async function run<Result>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<Result>) {
  const database = await open();
  return new Promise<Result>((resolve, reject) => {
    const request = action(database.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** The value kept under this key, or null. */
export async function readKept<Value>(key: string): Promise<Value | null> {
  try {
    return ((await run('readonly', store => store.get(key))) as Value | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Keeps a value under this key: whether it was kept. */
export async function keep(key: string, value: unknown): Promise<boolean> {
  try {
    await run('readwrite', store => store.put(value, key));
    return true;
  } catch {
    return false;
  }
}

/** The keys kept that start with this, to know what is already on the device. */
export async function keptKeys(prefix: string): Promise<Set<string>> {
  try {
    const keys = await run('readonly', store => store.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)));
    return new Set(keys.map(String));
  } catch {
    return new Set();
  }
}

/** Takes off this device the key given, and every key that starts with it. */
export async function forgetKept(prefix: string): Promise<void> {
  try {
    await run('readwrite', store => store.delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`)));
  } catch {
    // Nothing kept, or storage blocked.
  }
}

/** The owner's log as last read, shown at once on the next visit. */
export const OWNER_DOC = 'owner:doc';
/** The key of a log's samples: the owner's, and those of a visitor's own log (kept apart, as a sign-out drops the first). */
export const seriesKept = (id: string) => `owner:series:${id}`;
export const localSeriesKept = (id: string) => `local:series:${id}`;
