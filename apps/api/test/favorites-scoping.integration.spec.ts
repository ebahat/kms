import request from 'supertest';
import { newObjectId } from '@kms/data';
import { buildTestApp, closeTestApp, TestAppContext } from './support/test-app';
import { seedFolder, mintSessionCookie } from './support/fixtures';

/**
 * Favorites review finding #5 (2026-08-30): favorites.controller.spec.ts mocks
 * FavoritesRepository wholesale, so OwnerScopedRepository's actual scoping — the entire
 * confidentiality guarantee this feature rests on — was never exercised end to end. Real HTTP
 * requests through the full guard chain against an in-memory Mongo + fake Redis, matching
 * folders-permission-matrix/chat-permission-matrix's own precedent.
 */
describe('FavoritesController — owner/tenant scoping (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('lets a user add and list their own folder favorite', async () => {
    const tenantId = newObjectId();
    const userId = newObjectId();
    const folder = await seedFolder(ctx.app, { tenantId, isPublic: true });
    const cookie = await mintSessionCookie(ctx.app, { userId, tenantId });

    await request(ctx.app.getHttpServer())
      .post('/favorites')
      .set('Cookie', cookie)
      .send({ targetType: 'folder', targetId: folder._id.toString() })
      .expect(201);

    const res = await request(ctx.app.getHttpServer()).get('/favorites').set('Cookie', cookie).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].targetId).toBe(folder._id.toString());
  });

  it('does not leak user A\'s favorite into user B\'s list, even in the same tenant with the same folder access', async () => {
    const tenantId = newObjectId();
    const userA = newObjectId();
    const userB = newObjectId();
    const folder = await seedFolder(ctx.app, { tenantId, isPublic: true });
    const cookieA = await mintSessionCookie(ctx.app, { userId: userA, tenantId });
    const cookieB = await mintSessionCookie(ctx.app, { userId: userB, tenantId });

    await request(ctx.app.getHttpServer())
      .post('/favorites')
      .set('Cookie', cookieA)
      .send({ targetType: 'folder', targetId: folder._id.toString() })
      .expect(201);

    const resB = await request(ctx.app.getHttpServer()).get('/favorites').set('Cookie', cookieB).expect(200);
    expect(resB.body).toHaveLength(0);
  });

  it('404s user B removing a target user A favorited — B has no favorite of their own to find', async () => {
    const tenantId = newObjectId();
    const userA = newObjectId();
    const userB = newObjectId();
    const folder = await seedFolder(ctx.app, { tenantId, isPublic: true });
    const cookieA = await mintSessionCookie(ctx.app, { userId: userA, tenantId });
    const cookieB = await mintSessionCookie(ctx.app, { userId: userB, tenantId });

    await request(ctx.app.getHttpServer())
      .post('/favorites')
      .set('Cookie', cookieA)
      .send({ targetType: 'folder', targetId: folder._id.toString() })
      .expect(201);

    await request(ctx.app.getHttpServer())
      .delete(`/favorites/folder/${folder._id.toString()}`)
      .set('Cookie', cookieB)
      .expect(404);

    // A's favorite survives B's attempt.
    const resA = await request(ctx.app.getHttpServer()).get('/favorites').set('Cookie', cookieA).expect(200);
    expect(resA.body).toHaveLength(1);
  });

  it('404s favoriting a folder that belongs to another tenant', async () => {
    const tenantA = newObjectId();
    const tenantB = newObjectId();
    const folderInB = await seedFolder(ctx.app, { tenantId: tenantB, isPublic: true });
    const cookieA = await mintSessionCookie(ctx.app, { userId: newObjectId(), tenantId: tenantA });

    await request(ctx.app.getHttpServer())
      .post('/favorites')
      .set('Cookie', cookieA)
      .send({ targetType: 'folder', targetId: folderInB._id.toString() })
      .expect(404);
  });

  it('404s favoriting a folder the user cannot read (private, no grant)', async () => {
    const tenantId = newObjectId();
    const folder = await seedFolder(ctx.app, { tenantId, isPublic: false });
    const cookie = await mintSessionCookie(ctx.app, { userId: newObjectId(), tenantId, role: 'user' });

    await request(ctx.app.getHttpServer())
      .post('/favorites')
      .set('Cookie', cookie)
      .send({ targetType: 'folder', targetId: folder._id.toString() })
      .expect(404);
  });

  it('drops a favorite from the list once the underlying folder access is revoked', async () => {
    const tenantId = newObjectId();
    const userId = newObjectId();
    const folder = await seedFolder(ctx.app, {
      tenantId,
      grants: [{ principalType: 'user', principalId: userId, access: 'read' }],
    });
    const cookie = await mintSessionCookie(ctx.app, { userId, tenantId, role: 'user' });
    // Revoking via the real endpoint (not the bare repository method) so permVersion actually
    // bumps and the permission cache invalidates — matches how this happens in production.
    const adminCookie = await mintSessionCookie(ctx.app, { userId: newObjectId(), tenantId, role: 'admin' });

    await request(ctx.app.getHttpServer())
      .post('/favorites')
      .set('Cookie', cookie)
      .send({ targetType: 'folder', targetId: folder._id.toString() })
      .expect(201);

    let res = await request(ctx.app.getHttpServer()).get('/favorites').set('Cookie', cookie).expect(200);
    expect(res.body).toHaveLength(1);

    await request(ctx.app.getHttpServer())
      .delete(`/folders/${folder._id.toString()}/grants`)
      .set('Cookie', adminCookie)
      .send({ principalType: 'user', principalId: userId.toString() })
      .expect(200);

    res = await request(ctx.app.getHttpServer()).get('/favorites').set('Cookie', cookie).expect(200);
    expect(res.body).toHaveLength(0);
  });

  it('401s an unauthenticated request', async () => {
    await request(ctx.app.getHttpServer()).get('/favorites').expect(401);
  });
});
