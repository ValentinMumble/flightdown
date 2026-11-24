import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {isOwner, isOwnerKey, ownerCookies, requireOwner} from '../_lib/owner';

const KEY = 'a-test-owner-key';
const request = (headers: Record<string, string> = {}, url = 'https://flightdown.vumble.dev/api/data') =>
  new Request(url, {headers});

describe('the owner check', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.OWNER_KEY;
    process.env.OWNER_KEY = KEY;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.OWNER_KEY;
    else process.env.OWNER_KEY = saved;
  });

  it('takes the key as a bearer token, and nothing else', () => {
    expect(isOwner(request({authorization: `Bearer ${KEY}`}))).toBe(true);
    expect(isOwner(request({authorization: 'Bearer another-key'}))).toBe(false);
    expect(isOwner(request())).toBe(false);
  });

  it('takes the session cookie it sets at sign-in, not the key itself as a cookie', () => {
    const session = ownerCookies(request(), true)[0].split(';')[0];
    expect(isOwner(request({cookie: `other=1; ${session}`}))).toBe(true);
    expect(isOwner(request({cookie: `flightdown_session=${KEY}`}))).toBe(false);
  });

  it('signs every browser out when the key changes', () => {
    const session = ownerCookies(request(), true)[0].split(';')[0];
    process.env.OWNER_KEY = 'a-new-key';
    expect(isOwner(request({cookie: session}))).toBe(false);
  });

  it('lets nobody in when no key is set', () => {
    delete process.env.OWNER_KEY;
    expect(isOwner(request({authorization: 'Bearer '}))).toBe(false);
    expect(isOwnerKey('')).toBe(false);
    expect(() => requireOwner(request())).toThrow('Only the site owner');
  });

  it('marks its cookies Secure on https only, and clears them at sign-out', () => {
    expect(ownerCookies(request(), true)[0]).toContain('Secure');
    expect(ownerCookies(request({}, 'http://localhost:5173/api/login'), true)[0]).not.toContain('Secure');
    expect(ownerCookies(request(), false)[0]).toContain('Max-Age=0');
  });
});
