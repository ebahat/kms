import request from 'supertest';
import { newObjectId } from '@kms/data';
import { buildTestApp, closeTestApp, TestAppContext } from './support/test-app';
import { seedFolder, seedGroup, mintSessionCookie } from './support/fixtures';

/**
 * Phase 2 UI plan Task 7.1 — populates 2.7's stated target (the still-skeleton
 * test/cross-tenant/ harness never got real folder-permission fixtures; this is that suite,
 * placed alongside Phase 2A's own integration specs since it reuses the identical
 * mongodb-memory-server/ioredis-mock harness rather than building a second one). Covers
 * inheritance, override-not-merge, isPublic, group membership, widening detection,
 * cross-tenant 404s, and permVersion cache invalidation through a real (if in-memory) Redis —
 * none of which the unit-level controller specs exercise end to end through the real guard
 * chain + real cache.
 */
describe('Folder permission matrix (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('404s a folder that belongs to a different tenant', async () => {
    const tenantA = newObjectId();
    const tenantB = newObjectId();
    const folder = await seedFolder(ctx.app, { tenantId: tenantB, isPublic: true });
    const cookie = await mintSessionCookie(ctx.app, { userId: newObjectId(), tenantId: tenantA });

    await request(ctx.app.getHttpServer()).get(`/folders/${folder._id.toString()}`).set('Cookie', cookie).expect(404);
  });

  it('inherits a public parent — any tenant user can read a non-overriding child', async () => {
    const tenantId = newObjectId();
    const parent = await seedFolder(ctx.app, { tenantId, isPublic: true });
    const child = await seedFolder(ctx.app, { tenantId, parentId: parent._id });
    const cookie = await mintSessionCookie(ctx.app, { userId: newObjectId(), tenantId });

    const res = await request(ctx.app.getHttpServer()).get(`/folders/${child._id.toString()}`).set('Cookie', cookie).expect(200);
    expect(res.body.tier).toBe('read');
    expect(res.body.isPublic).toBe(false); // inherited, not its own flag
  });

  it('override-not-merge: an explicit-grant child does not inherit its public parent', async () => {
    const tenantId = newObjectId();
    const grantedUserId = newObjectId();
    const strangerId = newObjectId();
    const parent = await seedFolder(ctx.app, { tenantId, isPublic: true });
    const child = await seedFolder(ctx.app, {
      tenantId,
      parentId: parent._id,
      grants: [{ principalType: 'user', principalId: grantedUserId, access: 'read' }],
    });

    const grantedCookie = await mintSessionCookie(ctx.app, { userId: grantedUserId, tenantId });
    await request(ctx.app.getHttpServer()).get(`/folders/${child._id.toString()}`).set('Cookie', grantedCookie).expect(200);

    const strangerCookie = await mintSessionCookie(ctx.app, { userId: strangerId, tenantId });
    await request(ctx.app.getHttpServer()).get(`/folders/${child._id.toString()}`).set('Cookie', strangerCookie).expect(404);
  });

  it('resolves group membership: a group grant is only readable by its members', async () => {
    const tenantId = newObjectId();
    const memberId = newObjectId();
    const nonMemberId = newObjectId();
    const group = await seedGroup(ctx.app, { tenantId, memberUserIds: [memberId], name: 'Sales' });
    const folder = await seedFolder(ctx.app, {
      tenantId,
      grants: [{ principalType: 'group', principalId: group._id, access: 'read' }],
    });

    const memberCookie = await mintSessionCookie(ctx.app, { userId: memberId, tenantId });
    await request(ctx.app.getHttpServer()).get(`/folders/${folder._id.toString()}`).set('Cookie', memberCookie).expect(200);

    const nonMemberCookie = await mintSessionCookie(ctx.app, { userId: nonMemberId, tenantId });
    await request(ctx.app.getHttpServer()).get(`/folders/${folder._id.toString()}`).set('Cookie', nonMemberCookie).expect(404);
  });

  it('flags a widening override with the added group name, visible to any reader', async () => {
    const tenantId = newObjectId();
    const readerId = newObjectId();
    const group = await seedGroup(ctx.app, { tenantId, memberUserIds: [readerId], name: 'Widened Group' });
    const parent = await seedFolder(ctx.app, {
      tenantId,
      grants: [{ principalType: 'user', principalId: readerId, access: 'read' }],
    });
    await seedFolder(ctx.app, {
      tenantId,
      parentId: parent._id,
      grants: [
        { principalType: 'user', principalId: readerId, access: 'read' },
        { principalType: 'group', principalId: group._id, access: 'read' },
      ],
    });
    const cookie = await mintSessionCookie(ctx.app, { userId: readerId, tenantId });

    const res = await request(ctx.app.getHttpServer()).get(`/folders?parentId=${parent._id.toString()}`).set('Cookie', cookie).expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].broaderThanParent).toBe(true);
    expect(res.body[0].addedGroups).toEqual(['Widened Group']);
  });

  it('a grant added through the real API takes effect immediately for the same permVersion-cached user', async () => {
    const tenantId = newObjectId();
    const targetUserId = newObjectId();
    const adminId = newObjectId();
    const folder = await seedFolder(ctx.app, { tenantId });
    const userCookie = await mintSessionCookie(ctx.app, { userId: targetUserId, tenantId });
    const adminCookie = await mintSessionCookie(ctx.app, { userId: adminId, tenantId, role: 'admin' });

    // First read populates (or would populate) a cached resolution that excludes this folder.
    await request(ctx.app.getHttpServer()).get(`/folders/${folder._id.toString()}`).set('Cookie', userCookie).expect(404);

    await request(ctx.app.getHttpServer())
      .post(`/folders/${folder._id.toString()}/grants`)
      .set('Cookie', adminCookie)
      .send({ principalType: 'user', principalId: targetUserId.toString(), access: 'read' })
      .expect(201);

    // permVersion bump must invalidate the earlier cached miss — this is the real regression
    // Task 7 of the backend plan fixed (create()/move() previously skipped the bump; grant
    // mutations always bumped, but this proves the end-to-end cache-invalidation path actually
    // works through a real Redis client, not just a mocked PermissionCache in a unit test).
    await request(ctx.app.getHttpServer()).get(`/folders/${folder._id.toString()}`).set('Cookie', userCookie).expect(200);
  });

  it('401s an unauthenticated request', async () => {
    const folder = await seedFolder(ctx.app, { tenantId: newObjectId(), isPublic: true });
    await request(ctx.app.getHttpServer()).get(`/folders/${folder._id.toString()}`).expect(401);
  });
});
