import {albumToken, readAlbum, type AssetUrls, type StreamPhoto} from '../src/model/album.js';
import {handle, HttpError, json, readJson} from './_lib/http.js';
import {requireOwner} from './_lib/owner.js';
import {putAlbumCopy, putAlbumLink, readAlbumCopy, readAlbumLink} from './_lib/store.js';

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Apple answers the addresses of 25 photos at a time. */
const BATCH = 25;
/** How long a read of the album is used before Apple is asked again (its photo addresses last a few hours). */
const FRESH = 45 * 60 * 1000;
const HEADERS = {
  'Content-Type': 'text/plain',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.8',
  Origin: 'https://www.icloud.com',
  Referer: 'https://www.icloud.com/sharedalbum/',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
};

/** The server of an album: its number is written in base 62 at the start of the token. */
function hostOf(token: string) {
  const digits = token[0] === 'A' ? token.slice(1, 2) : token.slice(1, 3);
  const number = [...digits].reduce((sum, digit) => sum * 62 + DIGITS.indexOf(digit), 0);
  return `p${String(number).padStart(2, '0')}-sharedstreams.icloud.com`;
}

async function ask(host: string, token: string, endpoint: string, body: unknown) {
  return fetch(`https://${host}/${token}/sharedstreams/${endpoint}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
}

/** The album's name and photos, read like its public web page does. */
async function readShared(token: string) {
  let host = hostOf(token);
  let answer = await ask(host, token, 'webstream', {streamCtag: null});
  if (answer.status === 330) {
    // Another server holds the album: Apple says which.
    host = ((await answer.json()) as {'X-Apple-MMe-Host'?: string})['X-Apple-MMe-Host'] ?? host;
    answer = await ask(host, token, 'webstream', {streamCtag: null});
  }
  if (!answer.ok) {
    throw new HttpError(404, 'Apple did not share this album: turn on its public website in Photos');
  }
  const stream = (await answer.json()) as {streamName?: string; photos?: StreamPhoto[]};
  const photos = stream.photos ?? [];
  const urls: AssetUrls = {items: {}, locations: {}};
  for (let start = 0; start < photos.length; start += BATCH) {
    const guids = photos.slice(start, start + BATCH).map(photo => photo.photoGuid);
    const reply = await ask(host, token, 'webasseturls', {photoGuids: guids});
    if (!reply.ok) throw new HttpError(502, 'Apple did not give the photos’ addresses');
    const batch = (await reply.json()) as AssetUrls;
    Object.assign(urls.items, batch.items);
    Object.assign(urls.locations, batch.locations);
  }
  return {name: stream.streamName ?? 'Shared album', photos: readAlbum(photos, urls)};
}

/**
 * GET /api/album: the shared album's name, link and photos (their addresses expire after a few hours). A read of the
 * last 45 minutes is used as it is; an older one is used when Apple does not answer.
 */
export function GET(request: Request) {
  return handle(async () => {
    requireOwner(request);
    const link = await readAlbumLink();
    if (!link) throw new HttpError(404, 'No shared album yet: add its link in Settings');
    const token = albumToken(link);
    if (!token) throw new HttpError(500, 'The saved album link is not one');
    const copy = await readAlbumCopy<{link: string}>();
    if (copy && copy.album.link === link && Date.now() - copy.at < FRESH) return json(copy.album);
    try {
      const album = {link, ...(await readShared(token))};
      await putAlbumCopy(album);
      return json(album);
    } catch (failure) {
      if (copy && copy.album.link === link) return json(copy.album);
      throw failure;
    }
  });
}

/** PUT /api/album { link }: keeps the link of the shared album, once Apple shows it; an empty link forgets it. */
export function PUT(request: Request) {
  return handle(async () => {
    requireOwner(request);
    const {link} = await readJson(request);
    if (link === null || link === '') {
      await putAlbumLink(null);
      return json({ok: true});
    }
    const token = typeof link === 'string' ? albumToken(link) : null;
    if (!token) throw new HttpError(400, 'Paste the link of a shared album (icloud.com/sharedalbum/#…)');
    const album = await readShared(token);
    const kept = `https://www.icloud.com/sharedalbum/#${token}`;
    await putAlbumLink(kept);
    await putAlbumCopy({link: kept, ...album});
    return json({link: kept, name: album.name, count: album.photos.length});
  });
}
