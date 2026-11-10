import {env, handle, HttpError, json, readJson} from './_lib/http.js';
import {isOwnerKey, ownerCookies} from './_lib/owner.js';

/** POST /api/login { key }: checks the owner key and keeps this browser in owner mode for a year, with a cookie. */
export function POST(request: Request) {
  return handle(async () => {
    env('OWNER_KEY');
    const {key} = await readJson(request);
    if (!isOwnerKey(key)) throw new HttpError(403, 'This owner key is not valid');
    const response = json({ok: true});
    for (const cookie of ownerCookies(request, true)) response.headers.append('Set-Cookie', cookie);
    return response;
  });
}
