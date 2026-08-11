import request from 'supertest';
import { newObjectId } from '@kms/data';
import { buildTestApp, closeTestApp, TestAppContext } from './support/test-app';
import { seedGroup, seedEvent, mintSessionCookie } from './support/fixtures';

/**
 * Task 9: real HTTP requests through the full guard chain
 * (SessionAuthGuard -> MfaGateGuard -> TosGateGuard -> EditionGuard ->
 * ModuleGuard) against an in-memory Mongo + fake Redis — not the direct
 * controller-instantiation unit tests that already cover the happy paths.
 */
describe('EventsController — cross-tenant / non-member / module-disabled (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('404s a cross-tenant groupId', async () => {
    const tenantA = newObjectId();
    const tenantB = newObjectId();
    const userA = newObjectId();
    const groupB = await seedGroup(ctx.app, { tenantId: tenantB, memberUserIds: [newObjectId()] });
    const cookie = await mintSessionCookie(ctx.app, { userId: userA, tenantId: tenantA });

    await request(ctx.app.getHttpServer())
      .get(`/groups/${groupB._id.toString()}/events`)
      .set('Cookie', cookie)
      .expect(404);
  });

  it('404s a non-member of the group', async () => {
    const tenantA = newObjectId();
    const memberUserId = newObjectId();
    const nonMemberUserId = newObjectId();
    const group = await seedGroup(ctx.app, { tenantId: tenantA, memberUserIds: [memberUserId] });
    const cookie = await mintSessionCookie(ctx.app, { userId: nonMemberUserId, tenantId: tenantA });

    await request(ctx.app.getHttpServer())
      .get(`/groups/${group._id.toString()}/events`)
      .set('Cookie', cookie)
      .expect(404);
  });

  it('200s a member reading their own group events', async () => {
    const tenantA = newObjectId();
    const memberUserId = newObjectId();
    const group = await seedGroup(ctx.app, { tenantId: tenantA, memberUserIds: [memberUserId] });
    await seedEvent(ctx.app, { tenantId: tenantA, groupId: group._id, createdBy: memberUserId });
    const cookie = await mintSessionCookie(ctx.app, { userId: memberUserId, tenantId: tenantA });

    const res = await request(ctx.app.getHttpServer())
      .get(`/groups/${group._id.toString()}/events`)
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body).toHaveLength(1);
  });

  it('404s when the tenant has calendar disabled', async () => {
    const tenantA = newObjectId();
    const memberUserId = newObjectId();
    const group = await seedGroup(ctx.app, { tenantId: tenantA, memberUserIds: [memberUserId] });
    const cookie = await mintSessionCookie(ctx.app, { userId: memberUserId, tenantId: tenantA, featureToggles: ['kanban'] }); // calendar NOT included

    await request(ctx.app.getHttpServer())
      .get(`/groups/${group._id.toString()}/events`)
      .set('Cookie', cookie)
      .expect(404);

    await request(ctx.app.getHttpServer())
      .post(`/groups/${group._id.toString()}/events`)
      .set('Cookie', cookie)
      .send({ title: 'x', startAt: new Date().toISOString(), endAt: new Date().toISOString() })
      .expect(404);
  });

  it('401s an unauthenticated request (no session cookie)', async () => {
    const group = await seedGroup(ctx.app, { tenantId: newObjectId(), memberUserIds: [newObjectId()] });

    await request(ctx.app.getHttpServer()).get(`/groups/${group._id.toString()}/events`).expect(401);
  });
});
