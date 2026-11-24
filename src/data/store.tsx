import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {
  emptyDoc,
  type Battery,
  type Change,
  type Doc,
  type Heli,
  type Kind,
  type Pack,
  type Spot,
  type TelemetrySeries,
} from '../types';
import {today} from '../model/format';
import {sampleLog} from './sample';
import {forget, readJson, writeJson} from './storage';
import {forgetKept, keep, keptKeys, localSeriesKept, OWNER_DOC, readKept, seriesKept} from './deviceCache';
import {call, readAnswer} from './http';
import {patchItem} from '../model/patch';

/**
 * Where the log lives:
 * - owner: on the server (Upstash Redis), for whoever signed in with OWNER_KEY. A copy stays in the browser so the
 *   app opens at once, and changes made without a connection (at the field) wait in an outbox until it is back.
 * - local: in this browser only, for a visitor who started their own log or imported their sheet.
 * - sample: a made-up log to look around; changes are not kept.
 */
export type Mode = 'loading' | 'owner' | 'local' | 'sample';

const LOCAL = 'flightdown.local';
/** Where the owner's log was kept before it moved to IndexedDB: read once, then dropped. */
const OWNER_CACHE = 'flightdown.owner-cache';
const OUTBOX = 'flightdown.outbox';
const PENDING_KEY = 'flightdown.owner-key';
/** Where a visitor's samples were kept before they moved to IndexedDB: still read. */
const seriesKey = (id: string) => `flightdown.series.${id}`;
/** After the log is read, the samples of this many latest logs are kept on the device for the field. */
const KEEP_LATEST = 40;
const HINT = 'flightdown_owner=1';

/** A kind of pack as kept before its packs were listed one by one: how many, how many dead, their buttons. */
type CountedBattery = Omit<Battery, 'packs'> & {
  packs?: Pack[];
  count?: number;
  dead?: number;
  buttons?: number[];
  buttonsSince?: string;
};

/** A counted kind's packs one by one: those on buttons first, in their order, the dead ones last (day unknown). */
function listPacks(battery: CountedBattery): Battery {
  if (battery.packs) return battery as Battery;
  const {count = 0, dead = 0, buttons = [], buttonsSince, ...rest} = battery;
  const total = Math.max(count, buttons.length);
  const packs = [...Array(total).keys()].map((index): Pack => ({
    number: index + 1,
    ...(index < buttons.length && {button: buttons[index], ...(buttonsSince && {since: buttonsSince})}),
    ...(index >= total - dead && {dead: buttonsSince ?? rest.bought ?? today()}),
  }));
  return {...rest, packs};
}

/** Fills fields added after a log was written, so older logs read like new ones. */
function upgrade(doc: Partial<Doc>): Doc {
  const full = {...emptyDoc(), ...doc};
  full.batteries = (full.batteries as CountedBattery[]).map(listPacks);
  full.sorties = full.sorties.map(sortie => ({
    ...sortie,
    broken: sortie.broken ?? [],
    skills: sortie.skills ?? [],
    links: sortie.links ?? [],
    telemetry: sortie.telemetry ?? [],
    notes: sortie.notes ?? '',
  }));
  return full;
}

export function applyChange(doc: Doc, change: Change): Doc {
  if (change.type === 'telemetry') return doc;
  const list = doc[change.kind] as {id: string}[];
  if (change.type === 'patch') {
    const next = list.map(item => (item.id === change.id ? patchItem(item, change.fields, change.drop) : item));
    return {...doc, [change.kind]: next};
  }
  if (change.type === 'delete') return {...doc, [change.kind]: list.filter(item => item.id !== change.id)};
  const index = list.findIndex(item => item.id === change.item.id);
  const next = index < 0 ? [...list, change.item] : list.map(item => (item.id === change.item.id ? change.item : item));
  return {...doc, [change.kind]: next};
}

/**
 * What becomes of a change the server did not take: kept until the owner signs in again (a cookie gone, a new key),
 * dropped for good (the server refused it, and says why), or sent again later (no connection, the server busy).
 */
export function afterRefusal(status: number | undefined): 'sign-in' | 'drop' | 'retry' {
  if (status === 401 || status === 403) return 'sign-in';
  if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) return 'drop';
  return 'retry';
}

/** The outbox once a change went: only that change comes off its head, should another tab have taken it off already. */
export function afterSent(queued: Change[], sent: Change): Change[] {
  return queued.length && JSON.stringify(queued[0]) === JSON.stringify(sent) ? queued.slice(1) : queued;
}

async function send(change: Change) {
  const headers = {'Content-Type': 'application/json'};
  let answer: Response;
  if (change.type === 'put' || change.type === 'patch') {
    answer = await call('/api/data', {method: 'POST', headers, body: JSON.stringify(change)});
  } else if (change.type === 'delete') {
    answer = await call(`/api/data?kind=${change.kind}&id=${encodeURIComponent(change.id)}`, {method: 'DELETE'});
  } else {
    answer = await call('/api/telemetry', {method: 'POST', headers, body: JSON.stringify(change.series)});
  }
  if (!answer.ok) {
    const {error} = (await answer.json().catch(() => ({}))) as {error?: string};
    throw Object.assign(new Error(error ?? `The server answered ${answer.status}`), {status: answer.status});
  }
}

interface Store {
  mode: Mode;
  doc: Doc;
  /** Changes still waiting for a connection (owner mode). */
  waiting: number;
  /** The last error from the server, if a change could not be saved. */
  error: string | null;
  heli: (id: string | undefined) => Heli | undefined;
  spot: (id: string | undefined) => Spot | undefined;
  put: <K extends Kind>(kind: K, item: Doc[K][number]) => void;
  /**
   * Sets some fields of an item and takes others out, leaving the rest as the server has it: for edits of part of an
   * item, so an older copy of its other fields (a sortie's logs, its weather) never goes back over newer ones.
   */
  patch: <K extends Kind>(
    kind: K,
    id: string,
    fields: Partial<Doc[K][number]>,
    drop?: readonly (keyof Doc[K][number] & string)[],
  ) => void;
  remove: (kind: Kind, id: string) => void;
  saveSeries: (series: TelemetrySeries) => void;
  loadSeries: (id: string) => Promise<TelemetrySeries | null>;
  signIn: (key: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Visitors: starts a log of their own in this browser, empty or from the sample. */
  startLocal: (from: 'empty' | 'sample') => void;
  /** Visitors: drops their own log and goes back to the sample. */
  resetLocal: () => void;
}

const StoreContext = createContext<Store | null>(null);

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore outside StoreProvider');
  return store;
}

const sample = () => sampleLog();

export function StoreProvider({children}: {children: ReactNode}) {
  const [mode, setMode] = useState<Mode>('loading');
  const [doc, setDoc] = useState<Doc>(emptyDoc);
  const [waiting, setWaiting] = useState(() => readJson<Change[]>(OUTBOX)?.length ?? 0);
  const [error, setError] = useState<string | null>(null);
  const sampleSeries = useRef<TelemetrySeries[]>([]);
  const seriesCache = useRef(new Map<string, TelemetrySeries>());
  const flushing = useRef(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const showSample = useCallback(() => {
    const {doc: made, series} = sample();
    sampleSeries.current = series;
    setDoc(made);
    setMode('sample');
  }, []);

  const showVisitor = useCallback(() => {
    const local = readJson<Doc>(LOCAL);
    if (local) {
      setDoc(upgrade(local));
      setMode('local');
    } else {
      showSample();
    }
  }, [showSample]);

  /**
   * Sends the outbox, oldest first; stops at the first failure and tries again later. One tab at a time (the outbox is
   * shared): two tabs sending the same first change would each take one off, and the second change would be lost.
   */
  const flush = useCallback(async () => {
    if (flushing.current || modeRef.current !== 'owner') return;
    flushing.current = true;
    const sendAll = async () => {
      for (;;) {
        const next = (readJson<Change[]>(OUTBOX) ?? [])[0];
        if (!next) break;
        try {
          await send(next);
        } catch (failure) {
          const outcome = afterRefusal((failure as {status?: number}).status);
          if (outcome === 'sign-in') {
            setError('Sign in again in Settings: your changes are kept until then');
            break;
          }
          if (outcome === 'retry') break;
          setError((failure as Error).message);
        }
        // Read again: changes made while this one was on its way were added behind it, and must stay.
        const rest = afterSent(readJson<Change[]>(OUTBOX) ?? [], next);
        writeJson(OUTBOX, rest);
        setWaiting(rest.length);
      }
    };
    try {
      if (navigator.locks) await navigator.locks.request(OUTBOX, {ifAvailable: true}, lock => lock && sendAll());
      else await sendAll();
    } finally {
      flushing.current = false;
    }
  }, []);

  const loadOwner = useCallback(async () => {
    const answer = await call('/api/data', {headers: {Accept: 'application/json'}});
    if (answer.status === 403 || answer.status === 404 || answer.status === 503) return false;
    if (!answer.ok) throw new Error(`The server answered ${answer.status}`);
    const fresh = upgrade(await readAnswer<Doc>(answer));
    // Changes still in the outbox are not on the server yet: laid over what it sent.
    const outbox = readJson<Change[]>(OUTBOX) ?? [];
    const merged = outbox.reduce(applyChange, fresh);
    setDoc(merged);
    void keep(OWNER_DOC, merged);
    forget(OWNER_CACHE);
    setMode('owner');
    return merged;
  }, []);

  /** The samples of the latest logs, kept on the device in the background, so the field has them with no signal. */
  const keepLatestSeries = useCallback(async (log: Doc) => {
    const kept = await keptKeys(seriesKept(''));
    const latest = [...log.sorties]
      .sort((left, right) => right.date.localeCompare(left.date))
      .flatMap(sortie => sortie.telemetry.map(file => file.id))
      .slice(0, KEEP_LATEST)
      .filter(id => !kept.has(seriesKept(id)));
    for (const id of latest) {
      if (!navigator.onLine || modeRef.current !== 'owner') return;
      try {
        const answer = await call(`/api/telemetry?id=${encodeURIComponent(id)}`);
        if (answer.ok) await keep(seriesKept(id), await readAnswer<TelemetrySeries>(answer));
      } catch {
        return;
      }
    }
  }, []);

  useEffect(() => {
    const start = async () => {
      // A key from a /#owner=... address: kept until the server turns it into a cookie.
      const match = /^#owner=(.+)$/.exec(window.location.hash);
      if (match) {
        writeJson(PENDING_KEY, decodeURIComponent(match[1]));
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      const pending = readJson<string>(PENDING_KEY);
      if (pending) {
        const answer = await fetch('/api/login', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({key: pending}),
        }).catch(() => null);
        if (answer && answer.status !== 0) forget(PENDING_KEY);
      }
      const ownerBrowser = document.cookie.split(/;\s*/).includes(HINT);
      const cached = ownerBrowser ? ((await readKept<Doc>(OWNER_DOC)) ?? readJson<Doc>(OWNER_CACHE)) : null;
      if (cached) {
        setDoc(upgrade(cached));
        setMode('owner');
      }
      try {
        const fresh = await loadOwner();
        if (fresh) {
          void flush();
          void keepLatestSeries(fresh);
          return;
        }
      } catch {
        // No connection: the cached log stays on screen, the outbox waits.
        if (cached) return;
      }
      forget(OWNER_CACHE);
      void forgetKept('owner:');
      showVisitor();
    };
    void start();
  }, [flush, loadOwner, keepLatestSeries, showVisitor]);

  // Back on the page: the log may have changed elsewhere (another device, `npm run logs`), so it is read again
  // before an edit here sends an old copy of an item over the new one.
  useEffect(() => {
    if (mode !== 'owner') return;
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 10_000) return;
      last = Date.now();
      void loadOwner().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [mode, loadOwner]);

  useEffect(() => {
    const retry = () => void flush();
    window.addEventListener('online', retry);
    const timer = window.setInterval(retry, 30_000);
    return () => {
      window.removeEventListener('online', retry);
      window.clearInterval(timer);
    };
  }, [flush]);

  const commit = useCallback(
    (change: Change) => {
      setDoc(current => {
        const next = applyChange(current, change);
        if (modeRef.current === 'local' && !writeJson(LOCAL, next)) {
          queueMicrotask(() => setError('This browser is full: the last change was not kept'));
        }
        if (modeRef.current === 'owner') void keep(OWNER_DOC, next);
        return next;
      });
      if (modeRef.current === 'owner') {
        const outbox = [...(readJson<Change[]>(OUTBOX) ?? []), change];
        if (writeJson(OUTBOX, outbox)) {
          setWaiting(outbox.length);
          void flush();
        } else {
          // This browser's storage is full: the change cannot wait for a connection, so it goes now or is lost.
          send(change).catch(() =>
            setError(
              'This device is full and offline: the last change was not saved. Free some space and make it again',
            ),
          );
        }
      }
    },
    [flush],
  );

  const helis = useMemo(() => new Map(doc.helis.map(heli => [heli.id, heli])), [doc.helis]);
  const spots = useMemo(() => new Map(doc.spots.map(spot => [spot.id, spot])), [doc.spots]);

  // Kept the same while the mode stays, so views that read samples do not read them again on every change to the log.
  const loadSeries = useCallback(
    async (id: string): Promise<TelemetrySeries | null> => {
      const cached = seriesCache.current.get(id);
      if (cached) return cached;
      let found: TelemetrySeries | null = null;
      if (mode === 'sample') found = sampleSeries.current.find(series => series.id === id) ?? null;
      else if (mode === 'local') {
        found = (await readKept<TelemetrySeries>(localSeriesKept(id))) ?? readJson<TelemetrySeries>(seriesKey(id));
      } else {
        const waitingSeries = (readJson<Change[]>(OUTBOX) ?? []).find(
          change => change.type === 'telemetry' && change.series.id === id,
        );
        if (waitingSeries?.type === 'telemetry') found = waitingSeries.series;
        else found = await readKept<TelemetrySeries>(seriesKept(id));
        if (!found) {
          const answer = await call(`/api/telemetry?id=${encodeURIComponent(id)}`);
          found = answer.ok ? await readAnswer<TelemetrySeries>(answer) : null;
          if (found) void keep(seriesKept(id), found);
        }
      }
      if (found) seriesCache.current.set(id, found);
      return found;
    },
    [mode],
  );

  const store = useMemo<Store>(
    () => ({
      mode,
      doc,
      waiting,
      error,
      heli: id => (id ? helis.get(id) : undefined),
      spot: id => (id ? spots.get(id) : undefined),
      put: (kind, item) => commit({type: 'put', kind, item}),
      patch: (kind, id, fields, drop) =>
        commit({
          type: 'patch',
          kind,
          id,
          fields: fields as Record<string, unknown>,
          ...(drop?.length && {drop: [...drop]}),
        }),
      remove: (kind, id) => commit({type: 'delete', kind, id}),
      saveSeries: series => {
        seriesCache.current.set(series.id, series);
        if (mode === 'local') void keep(localSeriesKept(series.id), series);
        if (mode === 'sample') sampleSeries.current.push(series);
        if (mode === 'owner') {
          void keep(seriesKept(series.id), series);
          commit({type: 'telemetry', series});
        }
      },
      loadSeries,
      signIn: async key => {
        const answer = await call('/api/login', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({key}),
        });
        if (!answer.ok) {
          const {error: message} = (await answer.json().catch(() => ({}))) as {error?: string};
          throw new Error(message ?? 'This key did not work');
        }
        const fresh = await loadOwner();
        if (!fresh) throw new Error('Signed in, but the log could not be read');
        void keepLatestSeries(fresh);
        setError(null);
        void flush();
      },
      signOut: async () => {
        await fetch('/api/logout', {method: 'POST'}).catch(() => null);
        forget(OWNER_CACHE);
        forget(OUTBOX);
        void forgetKept('owner:');
        setWaiting(0);
        seriesCache.current.clear();
        showVisitor();
      },
      startLocal: from => {
        const next = from === 'sample' ? doc : emptyDoc();
        if (from === 'sample') for (const one of sampleSeries.current) void keep(localSeriesKept(one.id), one);
        writeJson(LOCAL, next);
        setDoc(next);
        setMode('local');
      },
      resetLocal: () => {
        forget(LOCAL);
        showSample();
      },
    }),
    [
      mode,
      doc,
      waiting,
      error,
      helis,
      spots,
      commit,
      flush,
      loadSeries,
      loadOwner,
      keepLatestSeries,
      showVisitor,
      showSample,
    ],
  );

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
