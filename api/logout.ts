import {json} from './_lib/http.js';
import {ownerCookies} from './_lib/owner.js';

/** POST /api/logout: ends owner mode in this browser. */
export async function POST(request: Request) {
  const response = json({ok: true});
  for (const cookie of ownerCookies(request, false)) response.headers.append('Set-Cookie', cookie);
  return response;
}
