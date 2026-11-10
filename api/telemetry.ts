import type {TelemetrySeries} from '../src/types.js';
import {handle, HttpError, json, readJson} from './_lib/http.js';
import {requireOwner} from './_lib/owner.js';
import {putSeries, readSeries} from './_lib/store.js';

/** A few hundred points per sensor: a log thinned by the page stays far below this. */
const MAX_SERIES = 1_000_000;

/** GET /api/telemetry?id=...: the samples of one EdgeTX log. */
export function GET(request: Request) {
  return handle(async () => {
    requireOwner(request);
    const id = new URL(request.url).searchParams.get('id');
    if (!id) throw new HttpError(400, 'Say which log');
    const series = await readSeries(id);
    if (!series) throw new HttpError(404, 'No such log');
    return json(series);
  });
}

/** POST /api/telemetry { id, time, channels }: keeps the samples of one log. */
export function POST(request: Request) {
  return handle(async () => {
    requireOwner(request);
    const body = await readJson(request);
    if (typeof body.id !== 'string' || !Array.isArray(body.time) || !body.channels) {
      throw new HttpError(400, 'Expected a telemetry log');
    }
    if (JSON.stringify(body).length > MAX_SERIES) throw new HttpError(413, 'This log is too big');
    await putSeries(body as unknown as TelemetrySeries);
    return json({ok: true});
  });
}
