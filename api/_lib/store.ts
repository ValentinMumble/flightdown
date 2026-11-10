import {Redis} from '@upstash/redis';
import {KINDS, type Doc, type Kind, type TelemetrySeries} from '../../src/types';
import {HttpError} from './http.js';

/** One hash per kind of item (helis, spots, sessions, spares, batteries, tips, gear), by id. */
export const kindKey = (kind: Kind) => `flightdown:${kind}`;
/** Telemetry samples, by log id: read one at a time, when a session opens. */
export const TELEMETRY = 'flightdown:telemetry';
/** Heli photos lifted out of their background on the Mac (`npm run cutouts`): base64 PNGs, by photo URL. */
export const CUTOUTS = 'flightdown:cutouts';

let client: Redis | null = null;

/** The Upstash Redis client, from the variables Vercel adds when the store is connected. */
export function redis() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new HttpError(503, 'The data store is not connected yet');
  client ??= new Redis({url, token});
  return client;
}

export function isKind(value: unknown): value is Kind {
  return typeof value === 'string' && (KINDS as string[]).includes(value);
}

export async function readDoc(): Promise<Doc> {
  const store = redis();
  const hashes = await Promise.all(KINDS.map(kind => store.hgetall<Record<string, unknown>>(kindKey(kind))));
  return Object.fromEntries(KINDS.map((kind, index) => [kind, Object.values(hashes[index] ?? {})])) as unknown as Doc;
}

/** Writes items by id, in chunks: Upstash caps the size of one request. */
async function writeItems(kind: Kind, items: {id: string}[]) {
  const store = redis();
  for (let start = 0; start < items.length; start += 200) {
    const chunk = items.slice(start, start + 200);
    await store.hset(kindKey(kind), Object.fromEntries(chunk.map(item => [item.id, item])));
  }
}

export async function putItem(kind: Kind, item: {id: string}) {
  await redis().hset(kindKey(kind), {[item.id]: item});
}

export async function deleteItem(kind: Kind, id: string) {
  await redis().hdel(kindKey(kind), id);
}

/** Replaces the whole log (an import), telemetry included. */
export async function replaceDoc(doc: Doc, series: TelemetrySeries[]) {
  const store = redis();
  await store.del(...KINDS.map(kindKey), TELEMETRY);
  for (const kind of KINDS) if (doc[kind].length) await writeItems(kind, doc[kind]);
  for (const one of series) await putSeries(one);
}

export async function putSeries(series: TelemetrySeries) {
  await redis().hset(TELEMETRY, {[series.id]: series});
}

export async function readSeries(id: string) {
  return redis().hget<TelemetrySeries>(TELEMETRY, id);
}

export async function readCutout(photo: string) {
  return redis().hget<string>(CUTOUTS, photo);
}
