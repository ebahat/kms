import request from 'supertest';
import { newObjectId } from '@kms/data';
import { buildTestApp, closeTestApp, TestAppContext } from './support/test-app';
import { mintPlatformSessionCookie } from './support/fixtures';

/**
 * Real integration coverage for the Phase C follow-up (tenant edit, admin listing, admin
 * password-reset) — added specifically because a real bug (an unawaited lazy Mongoose query
 * losing its synthetic CLS scope before tenantScopeBackstopPlugin's pre-hook ran, throwing
 * UnscopedQueryError) slipped through every unit test (mocked repositories never exercise the
 * real backstop plugin) and was only caught by live-browser verification. This suite exercises
 * the exact same code paths against a real in-process mongod, so that class of bug fails CI
 * instead of only failing in a browser.
 */
describe('PlatformTenantsController — provisioning, edit, admin management (integration)', () => {
  let ctx: TestAppContext;
  let cookie: string;

  beforeAll(async () => {
    ctx = await buildTestApp();
    cookie = await mintPlatformSessionCookie(ctx.app, { adminId: newObjectId().toString() });
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  async function provisionTenant(overrides: Partial<{ name: string; subdomain: string; adminEmail: string }> = {}) {
    const suffix = Math.random().toString(36).slice(2, 8);
    const res = await request(ctx.app.getHttpServer())
      .post('/platform-admin/tenants/provision')
      .set('Cookie', cookie)
      .send({
        name: overrides.name ?? `Integration Co ${suffix}`,
        edition: 'kb',
        subdomain: overrides.subdomain ?? `int${suffix}`,
        adminEmail: overrides.adminEmail ?? `admin-${suffix}@integration.test`,
      })
      .expect(201);
    return res.body as { tenantId: string; subdomain: string; adminUserId: string; adminEmail: string; tempPassword: string };
  }

  it('provisions a tenant + admin, then lists that admin (regression: the CLS/backstop bug)', async () => {
    const provisioned = await provisionTenant();

    const res = await request(ctx.app.getHttpServer())
      .get(`/platform-admin/tenants/${provisioned.tenantId}/admins`)
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body).toEqual([{ id: provisioned.adminUserId, email: provisioned.adminEmail, status: 'active' }]);
  });

  it('resets the admin password, and a subsequent list still shows exactly one admin (regression: same bug class)', async () => {
    const provisioned = await provisionTenant();

    const res = await request(ctx.app.getHttpServer())
      .post(`/platform-admin/tenants/${provisioned.tenantId}/admins/${provisioned.adminUserId}/reset-password`)
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.tempPassword).toEqual(expect.any(String));
    expect(res.body.tempPassword).not.toBe(provisioned.tempPassword);

    const listRes = await request(ctx.app.getHttpServer())
      .get(`/platform-admin/tenants/${provisioned.tenantId}/admins`)
      .set('Cookie', cookie)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
  });

  it('404s resetting a password for a user that does not belong to this tenant (cross-tenant isolation)', async () => {
    const tenantA = await provisionTenant();
    const tenantB = await provisionTenant();

    await request(ctx.app.getHttpServer())
      .post(`/platform-admin/tenants/${tenantA.tenantId}/admins/${tenantB.adminUserId}/reset-password`)
      .set('Cookie', cookie)
      .expect(404);
  });

  it('lists only the admins that belong to this specific tenant (cross-tenant isolation)', async () => {
    const tenantA = await provisionTenant();
    await provisionTenant(); // tenant B — its admin must never appear in tenant A's list

    const res = await request(ctx.app.getHttpServer())
      .get(`/platform-admin/tenants/${tenantA.tenantId}/admins`)
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body).toEqual([expect.objectContaining({ email: tenantA.adminEmail })]);
  });

  it('edits a tenant\'s name/theme color, and the update is visible on GET', async () => {
    const provisioned = await provisionTenant();

    await request(ctx.app.getHttpServer())
      .patch(`/platform-admin/tenants/${provisioned.tenantId}`)
      .set('Cookie', cookie)
      .send({ name: 'Renamed Co', themeColorRgb: '#00aa55' })
      .expect(200);

    const res = await request(ctx.app.getHttpServer()).get(`/platform-admin/tenants/${provisioned.tenantId}`).set('Cookie', cookie).expect(200);

    expect(res.body).toMatchObject({ name: 'Renamed Co', themeColorRgb: '#00aa55' });
  });

  it('rejects every unauthenticated request the same way — no session cookie at all', async () => {
    await request(ctx.app.getHttpServer()).get('/platform-admin/tenants').expect(401);
  });
});
