import { INestApplication } from '@nestjs/common';
import { SessionService, REALM_COOKIE_NAME } from '@kms/auth';
import { SESSION_SERVICE } from '../../src/auth/platform-session-auth.guard';

/** Mints a real platform-realm session in the fake redis-app and returns the cookie header value to attach to a supertest request. */
export async function mintPlatformSessionCookie(app: INestApplication, opts: { adminId: string; mfaVerified?: boolean }): Promise<string> {
  const sessions = app.get<SessionService>(SESSION_SERVICE);
  const sessionId = await sessions.create('platform', {
    userId: opts.adminId,
    role: 'admin',
    mfaVerified: opts.mfaVerified ?? true,
  });
  return `${REALM_COOKIE_NAME.platform}=${sessionId}`;
}
