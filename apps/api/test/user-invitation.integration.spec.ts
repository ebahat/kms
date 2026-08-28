import request from 'supertest';
import { ClsService } from 'nestjs-cls';
import { newObjectId, UsersRepository } from '@kms/data';
import { buildTestApp, closeTestApp, TestAppContext } from './support/test-app';
import { mintSessionCookie, scopeFor, withScope } from './support/fixtures';
import { FakeNotificationProvider } from '../src/notifications/fake-notification-provider';
import { NOTIFICATION_PROVIDER } from '../src/notifications/notifications.providers';

/**
 * User-management plan (2026-08-24), Phase 3.9 — the invite-by-email activation flow end to end
 * through the real guard chain, a real (in-memory) Mongo, and the FakeNotificationProvider that
 * apps/api's own DI wiring falls back to whenever RESEND_API_KEY is unset (test-app.ts clears it).
 * Complements tenant-users-admin.controller.spec.ts and auth.controller.spec.ts's mocked unit
 * coverage of the same logic — this is what actually proves the pieces wire together: a real
 * create() writes a real token hash that a real activate/confirm can validate, and a real login()
 * afterward accepts the password that was actually set.
 */
describe('User invitation + activation (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  function latestInviteLink(): string {
    const provider = ctx.app.get<FakeNotificationProvider>(NOTIFICATION_PROVIDER);
    const last = provider.sent[provider.sent.length - 1];
    const match = last.body.match(/https?:\/\/\S+/);
    if (!match) throw new Error('no link found in the captured invite email body');
    return match[0];
  }

  function tokenFrom(link: string): string {
    return new URL(link).searchParams.get('token')!;
  }

  it('maps a malformed body to 400, not an unhandled 500 — security review finding, 2026-08-24', async () => {
    const tenantId = newObjectId();
    const adminCookie = await mintSessionCookie(ctx.app, { userId: newObjectId(), tenantId, role: 'admin' });

    await request(ctx.app.getHttpServer())
      .post('/tenant-admin/users')
      .set('Cookie', adminCookie)
      .send({ email: 'not-an-email', role: 'user' }) // missing firstName/lastName, invalid email
      .expect(400);
  });

  it('404s a malformed :id instead of an unhandled BSON error — security review finding, 2026-08-24', async () => {
    const tenantId = newObjectId();
    const adminCookie = await mintSessionCookie(ctx.app, { userId: newObjectId(), tenantId, role: 'admin' });

    await request(ctx.app.getHttpServer())
      .patch('/tenant-admin/users/not-an-object-id/deactivate')
      .set('Cookie', adminCookie)
      .expect(404);
  });

  it('create -> capture invite email -> activate -> can log in with the new password', async () => {
    const tenantId = newObjectId();
    const adminId = newObjectId();
    const adminCookie = await mintSessionCookie(ctx.app, { userId: adminId, tenantId, role: 'admin' });
    const email = `invitee-${newObjectId().toString()}@example.com`;

    const createRes = await request(ctx.app.getHttpServer())
      .post('/tenant-admin/users')
      .set('Cookie', adminCookie)
      .send({ email, firstName: 'Israel', lastName: 'Cohen', role: 'user' })
      .expect(201);
    expect(createRes.body).toEqual({ userId: expect.any(String), email, status: 'pending' });
    expect(createRes.body).not.toHaveProperty('tempPassword');

    const token = tokenFrom(latestInviteLink());

    const checkRes = await request(ctx.app.getHttpServer())
      .post('/auth/activate/check')
      .send({ email, token })
      .expect(200);
    expect(checkRes.body).toEqual({ valid: true });

    await request(ctx.app.getHttpServer())
      .post('/auth/activate/confirm')
      .send({ email, token, newPassword: 'a-genuinely-long-password-123' })
      .expect(200);

    // Password is real now, status flipped to active — login must accept it and reach the
    // interim MFA stage, not throw. mfaEnrolled:false confirms this is a fresh, never-enrolled
    // account, exactly what activation should produce.
    const loginRes = await request(ctx.app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'a-genuinely-long-password-123' })
      .expect(200);
    expect(loginRes.body).toEqual({ mfaRequired: true, mfaEnrolled: false });
  });

  it('an expired invite is rejected, and the user stays pending', async () => {
    const tenantId = newObjectId();
    const adminId = newObjectId();
    const adminCookie = await mintSessionCookie(ctx.app, { userId: adminId, tenantId, role: 'admin' });
    const email = `expiring-${newObjectId().toString()}@example.com`;

    await request(ctx.app.getHttpServer())
      .post('/tenant-admin/users')
      .set('Cookie', adminCookie)
      .send({ email, firstName: 'Israel', lastName: 'Cohen', role: 'user' })
      .expect(201);
    const token = tokenFrom(latestInviteLink());

    // Force the stored expiry into the past — this is the only way to test a 24h TTL without
    // actually waiting 24h. Goes through withScope + the real UsersRepository, exactly the same
    // tenantScopeBackstopPlugin-guarded path production writes use, not a raw model bypass.
    const cls = ctx.app.get(ClsService);
    const users = ctx.app.get(UsersRepository);
    const created = await users.findByEmailForAuth(email);
    await withScope(cls, scopeFor(created!.tenantId, created!._id), () =>
      users.updateOne({ _id: created!._id }, { $set: { inviteExpiresAt: new Date(Date.now() - 1000) } }),
    );

    await request(ctx.app.getHttpServer()).post('/auth/activate/check').send({ email, token }).expect(200, { valid: false });
    await request(ctx.app.getHttpServer())
      .post('/auth/activate/confirm')
      .send({ email, token, newPassword: 'a-genuinely-long-password-123' })
      .expect(401);

    const stillPending = await users.findByEmailForAuth(email);
    expect(stillPending!.status).toBe('pending');
  });

  it('deactivating a pending user kills their outstanding invite link immediately', async () => {
    const tenantId = newObjectId();
    const adminId = newObjectId();
    const adminCookie = await mintSessionCookie(ctx.app, { userId: adminId, tenantId, role: 'admin' });
    const email = `revoked-${newObjectId().toString()}@example.com`;

    const createRes = await request(ctx.app.getHttpServer())
      .post('/tenant-admin/users')
      .set('Cookie', adminCookie)
      .send({ email, firstName: 'Israel', lastName: 'Cohen', role: 'user' })
      .expect(201);
    const token = tokenFrom(latestInviteLink());

    await request(ctx.app.getHttpServer())
      .patch(`/tenant-admin/users/${createRes.body.userId}/deactivate`)
      .set('Cookie', adminCookie)
      .expect(200);

    await request(ctx.app.getHttpServer())
      .post('/auth/activate/confirm')
      .send({ email, token, newPassword: 'a-genuinely-long-password-123' })
      .expect(401);
  });

  it('reactivating a user who was deactivated while still pending sends a fresh, working invite', async () => {
    const tenantId = newObjectId();
    const adminId = newObjectId();
    const adminCookie = await mintSessionCookie(ctx.app, { userId: adminId, tenantId, role: 'admin' });
    const email = `reactivated-${newObjectId().toString()}@example.com`;

    const createRes = await request(ctx.app.getHttpServer())
      .post('/tenant-admin/users')
      .set('Cookie', adminCookie)
      .send({ email, firstName: 'Israel', lastName: 'Cohen', role: 'user' })
      .expect(201);
    const userId = createRes.body.userId;

    await request(ctx.app.getHttpServer()).patch(`/tenant-admin/users/${userId}/deactivate`).set('Cookie', adminCookie).expect(200);
    await request(ctx.app.getHttpServer()).patch(`/tenant-admin/users/${userId}/reactivate`).set('Cookie', adminCookie).expect(200);

    // The reactivate call sent a second invite email (the first was killed by deactivate) — its
    // token must be a genuinely new, working one.
    const provider = ctx.app.get<FakeNotificationProvider>(NOTIFICATION_PROVIDER);
    expect(provider.sent.filter((s) => s.to === email)).toHaveLength(2);
    const freshToken = tokenFrom(latestInviteLink());

    await request(ctx.app.getHttpServer())
      .post('/auth/activate/confirm')
      .send({ email, token: freshToken, newPassword: 'a-genuinely-long-password-123' })
      .expect(200);
  });

  it('a legacy active user (seeded before the activation flow existed, no activatedAt) survives deactivate+reactivate landing back on active, not pending — security review finding, 2026-08-24', async () => {
    const tenantId = newObjectId();
    const adminId = newObjectId();
    const adminCookie = await mintSessionCookie(ctx.app, { userId: adminId, tenantId, role: 'admin' });
    const email = `legacy-${newObjectId().toString()}@example.com`;

    const cls = ctx.app.get(ClsService);
    const users = ctx.app.get(UsersRepository);
    const legacyUserId = await withScope(cls, scopeFor(tenantId, adminId), () =>
      users
        .create({
          email,
          firstName: 'Legacy',
          lastName: 'Admin',
          role: 'user',
          passwordHash: 'not-a-real-hash',
          status: 'active',
          mfaEnabled: false,
          totpBackupCodeHashes: [],
          // activatedAt intentionally omitted — this is exactly what every pre-2026-08-24 account looks like.
        })
        .then((u) => u._id.toString()),
    );

    await request(ctx.app.getHttpServer()).patch(`/tenant-admin/users/${legacyUserId}/deactivate`).set('Cookie', adminCookie).expect(200);
    await request(ctx.app.getHttpServer()).patch(`/tenant-admin/users/${legacyUserId}/reactivate`).set('Cookie', adminCookie).expect(200);

    const listRes = await request(ctx.app.getHttpServer()).get('/tenant-admin/users').set('Cookie', adminCookie).expect(200);
    const reactivated = listRes.body.find((u: { id: string }) => u.id === legacyUserId);
    expect(reactivated.status).toBe('active'); // not forced back to 'pending'

    const provider = ctx.app.get<FakeNotificationProvider>(NOTIFICATION_PROVIDER);
    expect(provider.sent.some((s) => s.to === email)).toBe(false); // no spurious invite email sent
  });

  it('resend-invite for a user id belonging to another tenant 404s, not leaking cross-tenant existence', async () => {
    const tenantA = newObjectId();
    const tenantB = newObjectId();
    const adminA = await mintSessionCookie(ctx.app, { userId: newObjectId(), tenantId: tenantA, role: 'admin' });
    const adminB = await mintSessionCookie(ctx.app, { userId: newObjectId(), tenantId: tenantB, role: 'admin' });
    const email = `tenant-b-${newObjectId().toString()}@example.com`;

    const createRes = await request(ctx.app.getHttpServer())
      .post('/tenant-admin/users')
      .set('Cookie', adminB)
      .send({ email, firstName: 'Israel', lastName: 'Cohen', role: 'user' })
      .expect(201);

    await request(ctx.app.getHttpServer())
      .post(`/tenant-admin/users/${createRes.body.userId}/resend-invite`)
      .set('Cookie', adminA)
      .expect(404);
  });

  it('CSV import creates a user with a real group membership and sends its own invite email', async () => {
    const tenantId = newObjectId();
    const adminId = newObjectId();
    const adminCookie = await mintSessionCookie(ctx.app, { userId: adminId, tenantId, role: 'admin' });
    const email = `csv-${newObjectId().toString()}@example.com`;

    const groupRes = await request(ctx.app.getHttpServer())
      .post('/groups')
      .set('Cookie', adminCookie)
      .send({ name: `Sales-${newObjectId().toString()}` })
      .expect(201);

    const csvContent = ['email,firstName,lastName,role,groups', `${email},Israel,Cohen,user,${groupRes.body.name}:editor`].join('\n');
    const importRes = await request(ctx.app.getHttpServer())
      .post('/tenant-admin/users/import')
      .set('Cookie', adminCookie)
      .send({ csvContent })
      .expect(200);
    expect(importRes.body.results).toEqual([{ row: 1, email, status: 'created' }]);

    const groupDetail = await request(ctx.app.getHttpServer()).get(`/groups/${groupRes.body.id}`).set('Cookie', adminCookie).expect(200);
    expect(groupDetail.body.members).toHaveLength(1);
    expect(groupDetail.body.members[0].role).toBe('editor');

    const token = tokenFrom(latestInviteLink());
    await request(ctx.app.getHttpServer())
      .post('/auth/activate/confirm')
      .send({ email, token, newPassword: 'a-genuinely-long-password-123' })
      .expect(200);
  });
});
