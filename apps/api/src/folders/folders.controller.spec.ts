import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ZodError } from 'zod';
import { FolderCycleError, FolderNotEmptyError, newObjectId } from '@kms/data';
import { FoldersController } from './folders.controller';

function folderDoc(overrides: Partial<Record<string, any>> = {}) {
  return {
    _id: newObjectId(),
    parentId: null,
    name: 'Folder',
    grants: [],
    hasExplicitGrants: false,
    isPublic: false,
    // Real FoldersRepository.createFolder()/moveFolder() always set a real path array
    // (empty for a root folder) — never undefined, matching production data shape.
    path: [],
    ...overrides,
  };
}

describe('FoldersController (Phase 2 plan Task 3 — read routes)', () => {
  const tenantId = newObjectId();
  const userId = newObjectId();
  const groupId = newObjectId();

  let cls: any;
  let folders: any;
  let groups: any;
  let documents: any;
  let auditEvents: any;
  let cache: any;
  let controller: FoldersController;

  beforeEach(() => {
    cls = { get: jest.fn().mockReturnValue({ tenantId, userId, role: 'user', edition: 'kb', featureToggles: [] }) };
    folders = {
      findAllForTenant: jest.fn().mockResolvedValue([]),
      createFolder: jest.fn().mockImplementation((doc) => Promise.resolve(folderDoc(doc))),
      renameFolder: jest.fn(),
      moveFolder: jest.fn(),
      findChildren: jest.fn().mockResolvedValue([]),
      deleteOne: jest.fn().mockResolvedValue(undefined),
      upsertGrant: jest.fn(),
      revokeGrant: jest.fn(),
      resetToInherited: jest.fn(),
      setPublic: jest.fn(),
    };
    groups = { findForMember: jest.fn().mockResolvedValue([]), findAllForTenant: jest.fn().mockResolvedValue([]) };
    documents = { findByFolder: jest.fn().mockResolvedValue([]) };
    auditEvents = { record: jest.fn().mockResolvedValue(undefined) };
    // No real Redis in a unit test — every get* rejects so resolveFolderPermissionsCached/
    // computeFolderWideningCached fall through to direct computation (their own documented
    // "Redis unreachable" fallback), and every set* resolves as a no-op write.
    cache = {
      getVersion: jest.fn().mockRejectedValue(new Error('no redis in unit test')),
      getResolution: jest.fn(),
      setResolution: jest.fn().mockResolvedValue(undefined),
      getWidening: jest.fn().mockRejectedValue(new Error('no redis in unit test')),
      setWidening: jest.fn().mockResolvedValue(undefined),
      bumpVersion: jest.fn().mockResolvedValue(1),
    };
    controller = new FoldersController(cls, folders, groups, documents, auditEvents, cache);
  });

  describe('list', () => {
    it('returns only readable roots when parentId is omitted', async () => {
      const readableRoot = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'read' }] });
      const unreadableRoot = folderDoc({ hasExplicitGrants: true, grants: [] });
      folders.findAllForTenant.mockResolvedValue([readableRoot, unreadableRoot]);

      const result = await controller.list();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(readableRoot._id.toString());
    });

    it('filters to children of the given parentId', async () => {
      const parent = folderDoc({ hasExplicitGrants: true, isPublic: true });
      const child = folderDoc({ parentId: parent._id }); // inherits parent's public grant
      const otherRoot = folderDoc({ isPublic: true, hasExplicitGrants: true });
      folders.findAllForTenant.mockResolvedValue([parent, child, otherRoot]);

      const result = await controller.list(parent._id.toString());

      expect(result.map((f) => f.id)).toEqual([child._id.toString()]);
    });

    it('rejects a malformed parentId', async () => {
      await expect(controller.list('not-an-object-id')).rejects.toThrow(BadRequestException);
      expect(folders.findAllForTenant).not.toHaveBeenCalled();
    });

    it('a tenant admin sees every folder regardless of grants', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const noGrantFolder = folderDoc({ hasExplicitGrants: true, grants: [] });
      folders.findAllForTenant.mockResolvedValue([noGrantFolder]);

      const result = await controller.list();

      expect(result).toHaveLength(1);
      expect(result[0].tier).toBe('manage');
    });

    it('includes the widening badge on an override folder that grants a new group', async () => {
      const parent = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'read' }] });
      const child = folderDoc({
        parentId: parent._id,
        hasExplicitGrants: true,
        grants: [
          { principalType: 'user', principalId: userId, access: 'read' },
          { principalType: 'group', principalId: groupId, access: 'read' },
        ],
      });
      folders.findAllForTenant.mockResolvedValue([parent, child]);
      groups.findAllForTenant.mockResolvedValue([{ _id: groupId, name: 'Sales' }]);

      const result = await controller.list(parent._id.toString());

      expect(result[0].broaderThanParent).toBe(true);
      expect(result[0].addedGroups).toEqual(['Sales']);
    });

    it('resolves the ancestor path to names (Phase 2 UI plan Task 3 breadcrumb)', async () => {
      const grandparent = folderDoc({ name: 'Root', hasExplicitGrants: true, isPublic: true });
      const parent = folderDoc({ name: 'Mid', parentId: grandparent._id, path: [grandparent._id], hasExplicitGrants: false });
      const child = folderDoc({
        name: 'Leaf',
        parentId: parent._id,
        path: [grandparent._id, parent._id],
        hasExplicitGrants: false,
      });
      folders.findAllForTenant.mockResolvedValue([grandparent, parent, child]);

      const result = await controller.list(parent._id.toString());

      expect(result[0].path).toEqual([
        { id: grandparent._id.toString(), name: 'Root' },
        { id: parent._id.toString(), name: 'Mid' },
      ]);
    });

    it('omits unreadable ancestors from the path instead of leaking their name/existence', async () => {
      // Root: no grants, not public. Sub: inherits Root (still unreadable). Deep: explicit grant
      // for userId only (override-not-merge, so Deep's readability doesn't imply Sub's or Root's).
      const root = folderDoc({ name: 'Executive Comp Planning', hasExplicitGrants: false, isPublic: false });
      const sub = folderDoc({ name: '2026 Raises', parentId: root._id, path: [root._id], hasExplicitGrants: false });
      const deep = folderDoc({
        name: 'Finalists',
        parentId: sub._id,
        path: [root._id, sub._id],
        hasExplicitGrants: true,
        grants: [{ principalType: 'user', principalId: userId, access: 'read' }],
      });
      folders.findAllForTenant.mockResolvedValue([root, sub, deep]);

      const result = await controller.list(sub._id.toString());

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(deep._id.toString());
      expect(result[0].path).toEqual([]);
    });
  });

  describe('detail', () => {
    it('404s a nonexistent id', async () => {
      folders.findAllForTenant.mockResolvedValue([]);
      await expect(controller.detail(newObjectId().toString())).rejects.toThrow(NotFoundException);
    });

    it('404s a malformed id', async () => {
      await expect(controller.detail('not-an-object-id')).rejects.toThrow(NotFoundException);
      expect(folders.findAllForTenant).not.toHaveBeenCalled();
    });

    it('404s a folder outside the caller\'s permittedRead (never a raw denied response)', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      await expect(controller.detail(folder._id.toString())).rejects.toThrow(NotFoundException);
    });

    it('withholds the raw grants array below manage tier', async () => {
      const folder = folderDoc({
        hasExplicitGrants: true,
        grants: [{ principalType: 'user', principalId: userId, access: 'edit' }],
      });
      folders.findAllForTenant.mockResolvedValue([folder]);

      const result: any = await controller.detail(folder._id.toString());

      expect(result.tier).toBe('edit');
      expect(result.grants).toBeUndefined();
    });

    it('includes the raw grants array at manage tier', async () => {
      const folder = folderDoc({
        hasExplicitGrants: true,
        grants: [{ principalType: 'user', principalId: userId, access: 'manage' }],
      });
      folders.findAllForTenant.mockResolvedValue([folder]);

      const result: any = await controller.detail(folder._id.toString());

      expect(result.tier).toBe('manage');
      expect(result.grants).toEqual([{ principalType: 'user', principalId: userId.toString(), access: 'manage' }]);
    });

    it('omits unreadable ancestors from the path (same leak as list(), reached via GET /folders/:id)', async () => {
      const root = folderDoc({ name: 'Executive Comp Planning', hasExplicitGrants: false, isPublic: false });
      const sub = folderDoc({ name: '2026 Raises', parentId: root._id, path: [root._id], hasExplicitGrants: false });
      const deep = folderDoc({
        name: 'Finalists',
        parentId: sub._id,
        path: [root._id, sub._id],
        hasExplicitGrants: true,
        grants: [{ principalType: 'user', principalId: userId, access: 'read' }],
      });
      folders.findAllForTenant.mockResolvedValue([root, sub, deep]);

      const result: any = await controller.detail(deep._id.toString());

      expect(result.path).toEqual([]);
    });

    it('finds the folder when the id in the URL is uppercase hex (case-insensitive match)', async () => {
      const folder = folderDoc({
        hasExplicitGrants: true,
        grants: [{ principalType: 'user', principalId: userId, access: 'read' }],
      });
      folders.findAllForTenant.mockResolvedValue([folder]);

      const result = await controller.detail(folder._id.toString().toUpperCase());

      expect(result.id).toBe(folder._id.toString());
    });
  });

  describe('create (Phase 2 plan Task 4)', () => {
    it('rejects a non-admin creating a root folder', async () => {
      await expect(controller.create({ parentId: null, name: 'Root' })).rejects.toThrow(ForbiddenException);
      expect(folders.createFolder).not.toHaveBeenCalled();
    });

    it('lets an admin create a root folder, bumps permVersion, and audits', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });

      const result = await controller.create({ parentId: null, name: 'Root' });

      expect(folders.createFolder).toHaveBeenCalledWith({ name: 'Root', parentId: null });
      expect(result.parentId).toBeNull();
      expect(cache.bumpVersion).toHaveBeenCalledWith(tenantId.toString());
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'folder.created' }));
    });

    it('404s creating under a parent the caller can only read (not edit)', async () => {
      const parent = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'read' }] });
      folders.findAllForTenant.mockResolvedValue([parent]);

      await expect(controller.create({ parentId: parent._id.toString(), name: 'Child' })).rejects.toThrow(NotFoundException);
      expect(folders.createFolder).not.toHaveBeenCalled();
    });

    it('creates under a parent the caller can edit, bumps permVersion, and audits', async () => {
      const parent = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] });
      folders.findAllForTenant.mockResolvedValue([parent]);

      await controller.create({ parentId: parent._id.toString(), name: 'Child' });

      expect(folders.createFolder).toHaveBeenCalledWith({ name: 'Child', parentId: parent._id });
      expect(cache.bumpVersion).toHaveBeenCalledWith(tenantId.toString());
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'folder.created' }));
    });

    it('creates under a parent whose id was sent in uppercase hex (case-insensitive match)', async () => {
      const parent = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] });
      folders.findAllForTenant.mockResolvedValue([parent]);

      await controller.create({ parentId: parent._id.toString().toUpperCase(), name: 'Child' });

      expect(folders.createFolder).toHaveBeenCalledWith({ name: 'Child', parentId: parent._id });
    });

    it('rejects a malformed body', async () => {
      await expect(controller.create({ parentId: null, name: '' })).rejects.toThrow(ZodError);
      expect(folders.createFolder).not.toHaveBeenCalled();
    });

    it('applies each provided group grant to a new root folder and bumps/audits once, not once per grant (product-gaps batch, 2026-08-29 item 6)', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const groupA = newObjectId();
      const groupB = newObjectId();
      const created = folderDoc({ name: 'Root' });
      folders.createFolder.mockResolvedValue(created);
      folders.upsertGrant
        .mockResolvedValueOnce(folderDoc({ ...created, hasExplicitGrants: true, grants: [{ principalType: 'group', principalId: groupA, access: 'edit' }] }))
        .mockResolvedValueOnce(
          folderDoc({
            ...created,
            hasExplicitGrants: true,
            grants: [
              { principalType: 'group', principalId: groupA, access: 'edit' },
              { principalType: 'group', principalId: groupB, access: 'read' },
            ],
          }),
        );

      const result = await controller.create({
        parentId: null,
        name: 'Root',
        grants: [
          { principalType: 'group', principalId: groupA.toString(), access: 'edit' },
          { principalType: 'group', principalId: groupB.toString(), access: 'read' },
        ],
      });

      expect(folders.upsertGrant).toHaveBeenCalledTimes(2);
      expect(folders.upsertGrant).toHaveBeenNthCalledWith(1, created._id, { principalType: 'group', principalId: groupA, access: 'edit' });
      expect(folders.upsertGrant).toHaveBeenNthCalledWith(2, created._id, { principalType: 'group', principalId: groupB, access: 'read' });
      expect(result.hasExplicitGrants).toBe(true);
      expect(cache.bumpVersion).toHaveBeenCalledTimes(1);
      expect(auditEvents.record).toHaveBeenCalledTimes(1);
      expect(auditEvents.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'folder.created', metadata: expect.objectContaining({ grants: expect.arrayContaining([expect.objectContaining({ principalId: groupA.toString() })]) }) }),
      );
    });

    it('creates a root folder with no explicit grants when none are provided (grants stays optional)', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });

      await controller.create({ parentId: null, name: 'Root' });

      expect(folders.upsertGrant).not.toHaveBeenCalled();
    });

    it('rejects a grant with a non-group principalType at creation time (group-only, per contract)', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });

      await expect(
        controller.create({ parentId: null, name: 'Root', grants: [{ principalType: 'user', principalId: newObjectId().toString(), access: 'read' }] }),
      ).rejects.toThrow(ZodError);
    });
  });

  describe('rename', () => {
    it('404s below manage tier (edit alone is not enough)', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      await expect(controller.rename(folder._id.toString(), { name: 'New name' })).rejects.toThrow(NotFoundException);
      expect(folders.renameFolder).not.toHaveBeenCalled();
    });

    it('renames at manage tier, audits, and does not bump permVersion (name is not cached)', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);
      folders.renameFolder.mockResolvedValue({ ...folder, name: 'New name' });

      const result = await controller.rename(folder._id.toString(), { name: 'New name' });

      expect(folders.renameFolder).toHaveBeenCalledWith(folder._id, 'New name');
      expect(result.name).toBe('New name');
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'folder.renamed', targetId: folder._id }));
      expect(cache.bumpVersion).not.toHaveBeenCalled();
    });

    it('rejects a malformed body', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      await expect(controller.rename(folder._id.toString(), { name: '' })).rejects.toThrow(ZodError);
    });
  });

  describe('move', () => {
    it('404s without manage on the folder being moved', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      await expect(controller.move(folder._id.toString(), { parentId: null })).rejects.toThrow(NotFoundException);
      expect(folders.moveFolder).not.toHaveBeenCalled();
    });

    it('rejects a non-admin moving a folder to root', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      await expect(controller.move(folder._id.toString(), { parentId: null })).rejects.toThrow(ForbiddenException);
      expect(folders.moveFolder).not.toHaveBeenCalled();
    });

    it('lets an admin move a folder to root, bumps permVersion, and audits', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const folder = folderDoc();
      folders.findAllForTenant.mockResolvedValue([folder]);
      folders.moveFolder.mockResolvedValue({ ...folder, parentId: null });

      await controller.move(folder._id.toString(), { parentId: null });

      expect(folders.moveFolder).toHaveBeenCalledWith(folder._id, null);
      expect(cache.bumpVersion).toHaveBeenCalledWith(tenantId.toString());
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'folder.moved', targetId: folder._id }));
    });

    it('404s moving into a destination the caller cannot edit', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      const destination = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'read' }] });
      folders.findAllForTenant.mockResolvedValue([folder, destination]);

      await expect(controller.move(folder._id.toString(), { parentId: destination._id.toString() })).rejects.toThrow(NotFoundException);
      expect(folders.moveFolder).not.toHaveBeenCalled();
    });

    it('moves into a destination the caller can edit, reusing requireTier\'s resolution (single findAllForTenant call)', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      const destination = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] });
      folders.findAllForTenant.mockResolvedValue([folder, destination]);
      folders.moveFolder.mockResolvedValue({ ...folder, parentId: destination._id });

      await controller.move(folder._id.toString(), { parentId: destination._id.toString() });

      expect(folders.moveFolder).toHaveBeenCalledWith(folder._id, destination._id);
      expect(folders.findAllForTenant).toHaveBeenCalledTimes(1);
    });

    it('moves into a destination whose id was sent in uppercase hex (case-insensitive match)', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      const destination = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] });
      folders.findAllForTenant.mockResolvedValue([folder, destination]);
      folders.moveFolder.mockResolvedValue({ ...folder, parentId: destination._id });

      await controller.move(folder._id.toString(), { parentId: destination._id.toString().toUpperCase() });

      expect(folders.moveFolder).toHaveBeenCalledWith(folder._id, destination._id);
    });

    it('rejects a malformed body', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      await expect(controller.move(folder._id.toString(), { parentId: 'not-an-object-id' })).rejects.toThrow(ZodError);
    });

    it('propagates FolderCycleError from the repository (controller does not swallow it)', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      const destination = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] });
      folders.findAllForTenant.mockResolvedValue([folder, destination]);
      folders.moveFolder.mockRejectedValue(new FolderCycleError());

      await expect(controller.move(folder._id.toString(), { parentId: destination._id.toString() })).rejects.toThrow(FolderCycleError);
    });
  });

  describe('remove', () => {
    it('404s without manage tier', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      await expect(controller.remove(folder._id.toString())).rejects.toThrow(NotFoundException);
      expect(folders.deleteOne).not.toHaveBeenCalled();
    });

    it('rejects deleting a folder that still has subfolders', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);
      folders.findChildren.mockResolvedValue([folderDoc()]);

      await expect(controller.remove(folder._id.toString())).rejects.toThrow(FolderNotEmptyError);
      expect(folders.deleteOne).not.toHaveBeenCalled();
    });

    it('rejects deleting a folder that still has documents', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);
      documents.findByFolder.mockResolvedValue([{ _id: newObjectId() }]);

      await expect(controller.remove(folder._id.toString())).rejects.toThrow(FolderNotEmptyError);
      expect(folders.deleteOne).not.toHaveBeenCalled();
    });

    it('deletes an empty folder at manage tier and audits', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      const result = await controller.remove(folder._id.toString());

      expect(folders.deleteOne).toHaveBeenCalledWith({ _id: folder._id });
      expect(result).toEqual({ deleted: true });
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'folder.deleted', targetId: folder._id }));
    });
  });

  describe('addGrant (Phase 2 plan Task 5)', () => {
    const manageFolder = () => folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });

    it('404s below manage tier', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      await expect(
        controller.addGrant(folder._id.toString(), { principalType: 'user', principalId: newObjectId().toString(), access: 'read' }),
      ).rejects.toThrow(NotFoundException);
      expect(folders.upsertGrant).not.toHaveBeenCalled();
    });

    it('adds a grant, bumps permVersion, and records an audit event', async () => {
      const folder = manageFolder();
      const grantedUserId = newObjectId();
      folders.findAllForTenant.mockResolvedValue([folder]);
      folders.upsertGrant.mockResolvedValue({ ...folder, hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: grantedUserId, access: 'edit' }] });

      await controller.addGrant(folder._id.toString(), { principalType: 'user', principalId: grantedUserId.toString(), access: 'edit' });

      expect(folders.upsertGrant).toHaveBeenCalledWith(folder._id, { principalType: 'user', principalId: grantedUserId, access: 'edit' });
      expect(cache.bumpVersion).toHaveBeenCalledWith(tenantId.toString());
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'folder.grant.added', targetId: folder._id }));
    });

    it('does not fail the request when the permVersion bump fails (best-effort)', async () => {
      const folder = manageFolder();
      folders.findAllForTenant.mockResolvedValue([folder]);
      folders.upsertGrant.mockResolvedValue(folder);
      cache.bumpVersion.mockRejectedValue(new Error('redis down'));

      await expect(
        controller.addGrant(folder._id.toString(), { principalType: 'user', principalId: newObjectId().toString(), access: 'read' }),
      ).resolves.toBeDefined();
      expect(auditEvents.record).toHaveBeenCalled();
    });

    it('rejects a malformed body', async () => {
      const folder = manageFolder();
      folders.findAllForTenant.mockResolvedValue([folder]);

      await expect(
        controller.addGrant(folder._id.toString(), { principalType: 'user', principalId: 'not-an-object-id', access: 'read' }),
      ).rejects.toThrow(ZodError);
      expect(folders.upsertGrant).not.toHaveBeenCalled();
    });
  });

  describe('revokeGrant', () => {
    it('404s below manage tier', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      await expect(
        controller.revokeGrant(folder._id.toString(), { principalType: 'user', principalId: userId.toString() }),
      ).rejects.toThrow(NotFoundException);
      expect(folders.revokeGrant).not.toHaveBeenCalled();
    });

    it('revokes a grant, bumps permVersion, and audits', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);
      folders.revokeGrant.mockResolvedValue({ ...folder, grants: [] });

      await controller.revokeGrant(folder._id.toString(), { principalType: 'user', principalId: userId.toString() });

      expect(folders.revokeGrant).toHaveBeenCalledWith(folder._id, 'user', userId);
      expect(cache.bumpVersion).toHaveBeenCalled();
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'folder.grant.revoked' }));
    });
  });

  describe('resetToInherited', () => {
    it('404s below manage tier', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      await expect(controller.resetToInherited(folder._id.toString())).rejects.toThrow(NotFoundException);
      expect(folders.resetToInherited).not.toHaveBeenCalled();
    });

    it('clears the override, bumps permVersion, and audits', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);
      folders.resetToInherited.mockResolvedValue({ ...folder, hasExplicitGrants: false, grants: [] });

      await controller.resetToInherited(folder._id.toString());

      expect(folders.resetToInherited).toHaveBeenCalledWith(folder._id);
      expect(cache.bumpVersion).toHaveBeenCalled();
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'folder.grants.resetToInherited' }));
    });
  });

  describe('setPublic', () => {
    it('404s below manage tier', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      await expect(controller.setPublic(folder._id.toString(), { isPublic: true })).rejects.toThrow(NotFoundException);
      expect(folders.setPublic).not.toHaveBeenCalled();
    });

    it('sets isPublic, bumps permVersion, and audits', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);
      folders.setPublic.mockResolvedValue({ ...folder, isPublic: true });

      await controller.setPublic(folder._id.toString(), { isPublic: true });

      expect(folders.setPublic).toHaveBeenCalledWith(folder._id, true);
      expect(cache.bumpVersion).toHaveBeenCalled();
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'folder.public.changed', metadata: { isPublic: true } }));
    });

    it('rejects a malformed body', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      await expect(controller.setPublic(folder._id.toString(), { isPublic: 'yes' })).rejects.toThrow(ZodError);
    });
  });

  describe('effectivePermission', () => {
    it('404s below manage tier', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      await expect(controller.effectivePermission(folder._id.toString(), newObjectId().toString())).rejects.toThrow(NotFoundException);
    });

    it('requires a userId query param', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      await expect(controller.effectivePermission(folder._id.toString(), undefined)).rejects.toThrow(BadRequestException);
    });

    it("returns the target user's resolved tier and deciding grant", async () => {
      const targetUserId = newObjectId();
      const folder = folderDoc({
        hasExplicitGrants: true,
        grants: [
          { principalType: 'user', principalId: userId, access: 'manage' },
          { principalType: 'user', principalId: targetUserId, access: 'edit' },
        ],
      });
      folders.findAllForTenant.mockResolvedValue([folder]);

      const result = await controller.effectivePermission(folder._id.toString(), targetUserId.toString());

      expect(result.tier).toBe('edit');
      expect(result.decidingGrant).toEqual({ tier: 'edit', via: { principalType: 'user', principalId: targetUserId.toString() } });
    });

    it('returns a null tier and null decidingGrant for a target user with no access', async () => {
      const targetUserId = newObjectId();
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      const result = await controller.effectivePermission(folder._id.toString(), targetUserId.toString());

      expect(result.tier).toBeNull();
      expect(result.decidingGrant).toBeNull();
    });
  });

  describe('grantedGroups (cross-group visibility, product-gaps batch 2026-08-29 item 6/7e)', () => {
    it('404s a caller with only read tier — edit is the bar, not manage', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'read' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      await expect(controller.grantedGroups(folder._id.toString())).rejects.toThrow(NotFoundException);
    });

    it('returns group grants (name + tier) to a caller with edit tier — manage is not required', async () => {
      const otherGroupId = newObjectId();
      const folder = folderDoc({
        hasExplicitGrants: true,
        grants: [
          { principalType: 'user', principalId: userId, access: 'edit' },
          { principalType: 'group', principalId: groupId, access: 'edit' },
          { principalType: 'group', principalId: otherGroupId, access: 'read' },
        ],
      });
      folders.findAllForTenant.mockResolvedValue([folder]);
      groups.findAllForTenant.mockResolvedValue([
        { _id: groupId, name: 'מנהלים' },
        { _id: otherGroupId, name: 'צוות מטה' },
      ]);

      const result = await controller.grantedGroups(folder._id.toString());

      expect(result).toEqual([
        { groupId: groupId.toString(), groupName: 'מנהלים', access: 'edit' },
        { groupId: otherGroupId.toString(), groupName: 'צוות מטה', access: 'read' },
      ]);
    });

    it('never includes user-type grants in the response', async () => {
      const folder = folderDoc({
        hasExplicitGrants: true,
        grants: [
          { principalType: 'user', principalId: userId, access: 'manage' },
          { principalType: 'group', principalId: groupId, access: 'read' },
        ],
      });
      folders.findAllForTenant.mockResolvedValue([folder]);
      groups.findAllForTenant.mockResolvedValue([{ _id: groupId, name: 'Sales' }]);

      const result = await controller.grantedGroups(folder._id.toString());

      expect(result).toEqual([{ groupId: groupId.toString(), groupName: 'Sales', access: 'read' }]);
    });

    it('resolves group grants through inheritance for a folder with no explicit grants of its own', async () => {
      const parent = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'group', principalId: groupId, access: 'manage' }] });
      const child = folderDoc({ parentId: parent._id, path: [parent._id] });
      folders.findAllForTenant.mockResolvedValue([parent, child]);
      groups.findAllForTenant.mockResolvedValue([{ _id: groupId, name: 'Sales' }]);
      // The caller reaches edit tier on `child` via inherited group membership, not a direct grant —
      // this is exactly the "editors of these groups" scenario the feature is meant to serve.
      groups.findForMember.mockResolvedValue([{ _id: groupId, members: [{ userId, role: 'editor' }] }]);

      const result = await controller.grantedGroups(child._id.toString());

      expect(result).toEqual([{ groupId: groupId.toString(), groupName: 'Sales', access: 'manage' }]);
    });

    it('a tenant admin can always see the list, regardless of grants', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'group', principalId: groupId, access: 'read' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);
      groups.findAllForTenant.mockResolvedValue([{ _id: groupId, name: 'Sales' }]);

      const result = await controller.grantedGroups(folder._id.toString());

      expect(result).toEqual([{ groupId: groupId.toString(), groupName: 'Sales', access: 'read' }]);
    });

    it('404s a nonexistent folder', async () => {
      await expect(controller.grantedGroups(newObjectId().toString())).rejects.toThrow(NotFoundException);
    });
  });
});
