import type { Response } from 'express';
import { Realm, REALM_COOKIE_NAME, REALM_CLOCKS } from '@kms/auth';

/** __Host- prefix requires Secure + Path=/ + no Domain attribute (sec §2) — the cookie is pinned to its own hostname by construction. */
export function setSessionCookie(res: Response, realm: Realm, sessionId: string): void {
  res.cookie(REALM_COOKIE_NAME[realm], sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: REALM_CLOCKS[realm].absoluteMs,
  });
}

export function clearSessionCookie(res: Response, realm: Realm): void {
  res.clearCookie(REALM_COOKIE_NAME[realm], { path: '/' });
}
