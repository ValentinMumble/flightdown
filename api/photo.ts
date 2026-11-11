import type {Battery, Gear, Heli} from '../src/types.js';
import {handle, HttpError} from './_lib/http.js';
import {kindKey, readCutout, redis} from './_lib/store.js';

const MAX_BYTES = 8_000_000;

/**
 * GET /api/photo?url=...: the photo of a heli, a radio or a pack, served from this site so the page may read its pixels
 * and cut out the white background (most image hosts do not allow that across sites). Only photos set on something of
 * the log are fetched, and the CDN keeps them for a year. With &cut=1: the photo lifted out of its background on the
 * Mac, if it was.
 */
export function GET(request: Request) {
  return handle(async () => {
    const params = new URL(request.url).searchParams;
    const source = params.get('url') ?? '';
    if (!/^https?:\/\//.test(source)) throw new HttpError(400, 'Expected a photo URL');
    if (params.get('cut')) {
      const lifted = await readCutout(source);
      if (!lifted) throw new HttpError(404, 'This photo was not lifted yet: run npm run cutouts');
      return new Response(Buffer.from(lifted, 'base64'), {
        headers: {'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, s-maxage=604800'},
      });
    }
    const store = redis();
    const kinds = await Promise.all([
      store.hvals(kindKey('helis')) as Promise<Heli[]>,
      store.hvals(kindKey('gear')) as Promise<Gear[]>,
      store.hvals(kindKey('batteries')) as Promise<Battery[]>,
    ]);
    if (!kinds.flat().some(item => item.photo === source))
      throw new HttpError(404, 'Nothing in the log has this photo');
    const upstream = await fetch(source, {headers: {'User-Agent': 'Mozilla/5.0 (Flightdown)'}});
    const type = upstream.headers.get('content-type') ?? '';
    if (!upstream.ok || !type.startsWith('image/')) throw new HttpError(502, 'The photo could not be fetched');
    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) throw new HttpError(413, 'This photo is too big');
    return new Response(bytes, {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=86400, s-maxage=31536000, immutable',
      },
    });
  });
}
