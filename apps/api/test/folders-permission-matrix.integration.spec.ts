import request from 'supertest';
import { newObjectId, TenantsRepository } from '@kms/data';
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

  /**
   * User-management plan (2026-08-24): a group's grant on a folder is a ceiling; the member's own
   * viewer/editor/manager role narrows it. These prove the cap end to end through the real guard
   * chain (SessionAuthGuard -> requireTier -> resolveFolderPermissions), not just the pure resolver
   * function unit tests already cover — this is what actually stops a viewer from mutating content
   * even though their group has full access.
   */
  describe('group member role caps (viewer/editor/manager)', () => {
    it('a viewer-role member can read the folder but cannot create a subfolder in it (edit-gated) or manage it (grants)', async () => {
      const tenantId = newObjectId();
      const viewerId = newObjectId();
      const group = await seedGroup(ctx.app, { tenantId, members: [{ userId: viewerId, role: 'viewer' }], name: 'Viewers' });
      const folder = await seedFolder(ctx.app, {
        tenantId,
        grants: [{ principalType: 'group', principalId: group._id, access: 'manage' }],
      });
      const cookie = await mintSessionCookie(ctx.app, { userId: viewerId, tenantId });

      const detail = await request(ctx.app.getHttpServer()).get(`/folders/${folder._id.toString()}`).set('Cookie', cookie).expect(200);
      expect(detail.body.tier).toBe('read');

      await request(ctx.app.getHttpServer())
        .post('/folders')
        .set('Cookie', cookie)
        .send({ name: 'Subfolder', parentId: folder._id.toString() })
        .expect(404);

      await request(ctx.app.getHttpServer())
        .post(`/folders/${folder._id.toString()}/grants`)
        .set('Cookie', cookie)
        .send({ principalType: 'user', principalId: viewerId.toString(), access: 'read' })
        .expect(404);
    });

    it('an editor-role member can create content but cannot manage grants', async () => {
      const tenantId = newObjectId();
      const editorId = newObjectId();
      const group = await seedGroup(ctx.app, { tenantId, members: [{ userId: editorId, role: 'editor' }], name: 'Editors' });
      const folder = await seedFolder(ctx.app, {
        tenantId,
        grants: [{ principalType: 'group', principalId: group._id, access: 'manage' }],
      });
      const cookie = await mintSessionCookie(ctx.app, { userId: editorId, tenantId });

      const detail = await request(ctx.app.getHttpServer()).get(`/folders/${folder._id.toString()}`).set('Cookie', cookie).expect(200);
      expect(detail.body.tier).toBe('edit');

      await request(ctx.app.getHttpServer())
        .post('/folders')
        .set('Cookie', cookie)
        .send({ name: 'Subfolder', parentId: folder._id.toString() })
        .expect(201);

      await request(ctx.app.getHttpServer())
        .post(`/folders/${folder._id.toString()}/grants`)
        .set('Cookie', cookie)
        .send({ principalType: 'user', principalId: editorId.toString(), access: 'read' })
        .expect(404);
    });

    it('a manager-role member can manage grants — the full tier the group itself was granted', async () => {
      const tenantId = newObjectId();
      const managerId = newObjectId();
      const group = await seedGroup(ctx.app, { tenantId, members: [{ userId: managerId, role: 'manager' }], name: 'Managers' });
      const folder = await seedFolder(ctx.app, {
        tenantId,
        grants: [{ principalType: 'group', principalId: group._id, access: 'manage' }],
      });
      const cookie = await mintSessionCookie(ctx.app, { userId: managerId, tenantId });

      const detail = await request(ctx.app.getHttpServer()).get(`/folders/${folder._id.toString()}`).set('Cookie', cookie).expect(200);
      expect(detail.body.tier).toBe('manage');

      await request(ctx.app.getHttpServer())
        .post(`/folders/${folder._id.toString()}/grants`)
        .set('Cookie', cookie)
        .send({ principalType: 'user', principalId: managerId.toString(), access: 'read' })
        .expect(201);
    });

    it('a role cap never widens: a viewer-role member of a group granted only read stays at read (not upgraded by anything)', async () => {
      const tenantId = newObjectId();
      const viewerId = newObjectId();
      const group = await seedGroup(ctx.app, { tenantId, members: [{ userId: viewerId, role: 'viewer' }], name: 'ReadOnly' });
      const folder = await seedFolder(ctx.app, {
        tenantId,
        grants: [{ principalType: 'group', principalId: group._id, access: 'read' }],
      });
      const cookie = await mintSessionCookie(ctx.app, { userId: viewerId, tenantId });

      const detail = await request(ctx.app.getHttpServer()).get(`/folders/${folder._id.toString()}`).set('Cookie', cookie).expect(200);
      expect(detail.body.tier).toBe('read');
    });

    it('promoting a member from viewer to manager through the real API invalidates the cached (lower) resolution', async () => {
      const tenantId = newObjectId();
      const memberId = newObjectId();
      const adminId = newObjectId();
      const group = await seedGroup(ctx.app, { tenantId, members: [{ userId: memberId, role: 'viewer' }], name: 'Promotable' });
      const folder = await seedFolder(ctx.app, {
        tenantId,
        grants: [{ principalType: 'group', principalId: group._id, access: 'manage' }],
      });
      const memberCookie = await mintSessionCookie(ctx.app, { userId: memberId, tenantId });
      const adminCookie = await mintSessionCookie(ctx.app, { userId: adminId, tenantId, role: 'admin' });

      // Populates a cached resolution at the viewer's capped-to-read tier.
      const before = await request(ctx.app.getHttpServer()).get(`/folders/${folder._id.toString()}`).set('Cookie', memberCookie).expect(200);
      expect(before.body.tier).toBe('read');

      await request(ctx.app.getHttpServer())
        .patch(`/groups/${group._id.toString()}/members`)
        .set('Cookie', adminCookie)
        .send({ add: [{ userId: memberId.toString(), role: 'manager' }] })
        .expect(200);

      // The stale cached "read" resolution must not be served after the role change.
      const after = await request(ctx.app.getHttpServer()).get(`/folders/${folder._id.toString()}`).set('Cookie', memberCookie).expect(200);
      expect(after.body.tier).toBe('manage');
    });

    it('cross-tenant: a member of a same-named group in tenant B gets nothing in tenant A', async () => {
      const tenantA = newObjectId();
      const tenantB = newObjectId();
      const userId = newObjectId();
      const groupA = await seedGroup(ctx.app, { tenantId: tenantA, members: [], name: 'Same Name' });
      await seedGroup(ctx.app, { tenantId: tenantB, members: [{ userId, role: 'manager' }], name: 'Same Name' });
      const folder = await seedFolder(ctx.app, {
        tenantId: tenantA,
        grants: [{ principalType: 'group', principalId: groupA._id, access: 'manage' }],
      });
      const cookie = await mintSessionCookie(ctx.app, { userId, tenantId: tenantA });

      // This user is a manager of tenant B's "Same Name" group, not tenant A's — tenant A's folder
      // must be invisible to them regardless of the coincidental group name.
      await request(ctx.app.getHttpServer()).get(`/folders/${folder._id.toString()}`).set('Cookie', cookie).expect(404);
    });
  });

  /**
   * A minimal, real, valid PNG (1x1, magic-byte-sniffable) — real end-to-end coverage needs a real
   * upload to rename/move against, not a mocked file object like the unit specs use.
   */
  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
    'base64',
  );

  describe('document rename/move — group role caps (document-file-actions plan, 2026-08-28)', () => {
    it('an editor-role member can rename and move a document; a viewer-role member gets 404 on both', async () => {
      const tenantId = newObjectId();
      // Upload checks the tenant's real storage quota (assertWithinQuota) — seedFolder/seedGroup
      // never create a Tenant document, so a real one is needed here specifically (every other
      // test in this file only reads folders/groups, never uploads).
      await ctx.app.get(TenantsRepository).create({
        _id: tenantId,
        name: 'Upload Test Tenant',
        edition: 'kb',
        storageQuotaBytes: 1024 * 1024 * 1024,
        featureToggles: [],
      } as any);
      const editorId = newObjectId();
      const viewerId = newObjectId();
      const editorGroup = await seedGroup(ctx.app, { tenantId, members: [{ userId: editorId, role: 'editor' }], name: 'Editors' });
      const viewerGroup = await seedGroup(ctx.app, { tenantId, members: [{ userId: viewerId, role: 'viewer' }], name: 'Viewers' });
      const sourceFolder = await seedFolder(ctx.app, {
        tenantId,
        grants: [
          { principalType: 'group', principalId: editorGroup._id, access: 'manage' },
          { principalType: 'group', principalId: viewerGroup._id, access: 'manage' },
        ],
      });
      const destinationFolder = await seedFolder(ctx.app, {
        tenantId,
        grants: [
          { principalType: 'group', principalId: editorGroup._id, access: 'manage' },
          { principalType: 'group', principalId: viewerGroup._id, access: 'manage' },
        ],
      });
      const editorCookie = await mintSessionCookie(ctx.app, { userId: editorId, tenantId });
      const viewerCookie = await mintSessionCookie(ctx.app, { userId: viewerId, tenantId });

      const uploadRes = await request(ctx.app.getHttpServer())
        .post('/documents')
        .set('Cookie', editorCookie)
        .field('folderId', sourceFolder._id.toString())
        .attach('file', TINY_PNG, 'test.png')
        .expect(201);
      const documentId = uploadRes.body.documentId;

      // Viewer-role: 404 on both rename and move, despite the group having 'manage' on both folders.
      await request(ctx.app.getHttpServer())
        .patch(`/documents/${documentId}`)
        .set('Cookie', viewerCookie)
        .send({ name: 'renamed-by-viewer.png' })
        .expect(404);
      await request(ctx.app.getHttpServer())
        .patch(`/documents/${documentId}`)
        .set('Cookie', viewerCookie)
        .send({ folderId: destinationFolder._id.toString() })
        .expect(404);

      // Editor-role: both succeed.
      const renameRes = await request(ctx.app.getHttpServer())
        .patch(`/documents/${documentId}`)
        .set('Cookie', editorCookie)
        .send({ name: 'renamed.png' })
        .expect(200);
      expect(renameRes.body.name).toBe('renamed.png');

      const moveRes = await request(ctx.app.getHttpServer())
        .patch(`/documents/${documentId}`)
        .set('Cookie', editorCookie)
        .send({ folderId: destinationFolder._id.toString() })
        .expect(200);
      expect(moveRes.body.folderId).toBe(destinationFolder._id.toString());
    });
  });
});
