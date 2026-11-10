import {handle, HttpError, json} from './_lib/http.js';
import {parseLocation, type LatLng} from '../src/model/geo.js';

/** The hosts a shared Maps link starts on or goes through. */
const MAPS = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|maps\.apple|maps\.apple\.com|((www|maps|consent)\.)?google\.[a-z.]+)$/;
const HOPS = 6;

/**
 * Where a Maps page puts its place: its preview map, Apple's place tags, or a link to it. Not the map's starting view,
 * which Google sets from where the request comes from (this server), not from the place.
 */
export function placeInPage(page: string): LatLng | null {
  const center = /center=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/.exec(page);
  if (center) return parseLocation(`${center[1]},${center[2]}`);
  const latitude = /place:location:latitude"\s+content="(-?\d+\.\d+)"/.exec(page);
  const longitude = /place:location:longitude"\s+content="(-?\d+\.\d+)"/.exec(page);
  if (latitude && longitude) return parseLocation(`${latitude[1]},${longitude[1]}`);
  const pinned = /\/@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(page);
  return pinned ? parseLocation(`${pinned[1]},${pinned[2]}`) : null;
}

/**
 * GET /api/place?url=...: where a shared Google or Apple Maps link points. Share sheets give short links with no
 * coordinates in them (maps.app.goo.gl/..., maps.apple/p/...): this follows the redirects, reading each address, then
 * the page they end on. Only Maps hosts are fetched.
 */
export function GET(request: Request) {
  return handle(async () => {
    let address = new URL(request.url).searchParams.get('url') ?? '';
    for (let hop = 0; hop < HOPS; hop += 1) {
      let link: URL;
      try {
        link = new URL(address);
      } catch {
        throw new HttpError(400, 'Expected a Maps link');
      }
      if (link.protocol !== 'https:' || !MAPS.test(link.hostname)) {
        throw new HttpError(400, 'Only Google Maps and Apple Maps links can be read');
      }
      const inAddress = parseLocation(address);
      if (inAddress) return json(inAddress);
      const answer = await fetch(address, {
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
          'Accept-Language': 'en',
          // Past Google's cookie consent page, which European visitors land on first.
          Cookie: 'CONSENT=YES+cb; SOCS=CAI',
        },
      });
      const next = answer.headers.get('location');
      if (next) {
        address = new URL(next, address).href;
        continue;
      }
      const inPage = placeInPage(await answer.text());
      if (inPage) return json(inPage);
      break;
    }
    throw new HttpError(404, 'This link does not say where the place is: tap the map instead');
  });
}
