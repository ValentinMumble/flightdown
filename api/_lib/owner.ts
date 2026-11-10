import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {bearerToken, HttpError} from './http.js';

/** Proves owner mode: HttpOnly, so the page's scripts never see it. */
const SESSION_COOKIE = 'flightdown_session';
/** Tells the page it is in owner mode (no secret in it). */
const HINT_COOKIE = 'flightdown_owner';
const YEAR = 365 * 24 * 3600;

function sameSecret(given: string | null | undefined, expected: string | null | undefined) {
  if (!expected || !given) return false;
  // Hashing first gives both sides the same length, which timingSafeEqual needs.
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** The session cookie's value, derived from OWNER_KEY: changing the key signs every browser out. */
function sessionToken() {
  const key = process.env.OWNER_KEY;
  return key ? createHmac('sha256', key).update('flightdown owner session').digest('base64url') : null;
}

function cookie(request: Request, name: string) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

/** True when the request carries the owner's session cookie, or the owner key itself as a bearer token. */
export function isOwner(request: Request) {
  return (
    sameSecret(cookie(request, SESSION_COOKIE), sessionToken()) ||
    sameSecret(bearerToken(request), process.env.OWNER_KEY)
  );
}

export function isOwnerKey(key: unknown) {
  return typeof key === 'string' && sameSecret(key, process.env.OWNER_KEY);
}

export function requireOwner(request: Request) {
  if (!isOwner(request)) throw new HttpError(403, 'Only the site owner can do this');
}

/**
 * The cookies that start (for a year) or end owner mode in this browser. Cookies set by the server keep their
 * lifetime in Safari, unlike the page's own storage, which Safari clears after 7 days without a visit. SameSite=Lax
 * keeps them off other sites' requests that change data.
 */
export function ownerCookies(request: Request, signIn: boolean) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const lifetime = `Path=/; Max-Age=${signIn ? YEAR : 0}; SameSite=Lax${secure}`;
  return [
    `${SESSION_COOKIE}=${signIn ? sessionToken() : ''}; ${lifetime}; HttpOnly`,
    `${HINT_COOKIE}=${signIn ? '1' : ''}; ${lifetime}`,
  ];
}
