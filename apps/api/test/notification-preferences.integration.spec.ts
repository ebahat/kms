import request from 'supertest';
import { newObjectId } from '@kms/data';
import { buildTestApp, closeTestApp, TestAppContext } from './support/test-app';
import { mintSessionCookie } from './support/fixtures';

/**
 * Task 9 step 4: NotificationPreferencesController has no @Module() gate
 * (design doc decision — core document notifications aren't an opt-in
 * module), so it must keep working even when a tenant has every optional
 * module (calendar, kanban) disabled.
 */
describe('NotificationPreferencesController — works with every module disabled (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('GET creates and returns all-off defaults for a tenant with zero feature toggles', async () => {
    const cookie = await mintSessionCookie(ctx.app, { userId: newObjectId(), tenantId: newObjectId(), featureToggles: [] });

    const res = await request(ctx.app.getHttpServer())
      .get('/users/me/notification-preferences')
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body).toMatchObject({
      fileAdded: 'off',
      fileDeleted: 'off',
      taskAdded: 'off',
      taskDeleted: 'off',
      taskStatusChanged: 'off',
    });
  });

  it('PATCH updates a preference for a tenant with zero feature toggles', async () => {
    const cookie = await mintSessionCookie(ctx.app, { userId: newObjectId(), tenantId: newObjectId(), featureToggles: [] });

    const res = await request(ctx.app.getHttpServer())
      .patch('/users/me/notification-preferences')
      .set('Cookie', cookie)
      .send({ fileAdded: 'all' })
      .expect(200);

    expect(res.body).toMatchObject({ fileAdded: 'all', fileDeleted: 'off' });
  });

  it('rejects an unknown preference field', async () => {
    const cookie = await mintSessionCookie(ctx.app, { userId: newObjectId(), tenantId: newObjectId(), featureToggles: [] });

    await request(ctx.app.getHttpServer())
      .patch('/users/me/notification-preferences')
      .set('Cookie', cookie)
      .send({ notAField: 'all' })
      .expect(400);
  });

  it('401s an unauthenticated request (no session cookie)', async () => {
    await request(ctx.app.getHttpServer()).get('/users/me/notification-preferences').expect(401);
  });
});
