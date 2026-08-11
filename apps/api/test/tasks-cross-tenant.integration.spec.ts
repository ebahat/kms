import request from 'supertest';
import { newObjectId } from '@kms/data';
import { buildTestApp, closeTestApp, TestAppContext } from './support/test-app';
import { seedGroup, seedTask, mintSessionCookie } from './support/fixtures';

describe('TasksController — cross-tenant / non-member / module-disabled (integration)', () => {
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
      .get(`/groups/${groupB._id.toString()}/tasks`)
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
      .get(`/groups/${group._id.toString()}/tasks`)
      .set('Cookie', cookie)
      .expect(404);
  });

  it('200s a member reading their own group tasks', async () => {
    const tenantA = newObjectId();
    const memberUserId = newObjectId();
    const group = await seedGroup(ctx.app, { tenantId: tenantA, memberUserIds: [memberUserId] });
    await seedTask(ctx.app, { tenantId: tenantA, groupId: group._id, createdBy: memberUserId });
    const cookie = await mintSessionCookie(ctx.app, { userId: memberUserId, tenantId: tenantA });

    const res = await request(ctx.app.getHttpServer())
      .get(`/groups/${group._id.toString()}/tasks`)
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body).toHaveLength(1);
  });

  it('404s when the tenant has kanban disabled', async () => {
    const tenantA = newObjectId();
    const memberUserId = newObjectId();
    const group = await seedGroup(ctx.app, { tenantId: tenantA, memberUserIds: [memberUserId] });
    const cookie = await mintSessionCookie(ctx.app, { userId: memberUserId, tenantId: tenantA, featureToggles: ['calendar'] }); // kanban NOT included

    await request(ctx.app.getHttpServer())
      .get(`/groups/${group._id.toString()}/tasks`)
      .set('Cookie', cookie)
      .expect(404);

    await request(ctx.app.getHttpServer())
      .post(`/groups/${group._id.toString()}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'x' })
      .expect(404);
  });

  it('401s an unauthenticated request (no session cookie)', async () => {
    const group = await seedGroup(ctx.app, { tenantId: newObjectId(), memberUserIds: [newObjectId()] });

    await request(ctx.app.getHttpServer()).get(`/groups/${group._id.toString()}/tasks`).expect(401);
  });
});
