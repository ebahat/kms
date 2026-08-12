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
    };
    groups = { findForMember: jest.fn().mockResolvedValue([]), findAllForTenant: jest.fn().mockResolvedValue([]) };
    documents = { findByFolder: jest.fn().mockResolvedValue([]) };
    // No real Redis in a unit test — every get* rejects so resolveFolderPermissionsCached/
    // computeFolderWideningCached fall through to direct computation (their own documented
    // "Redis unreachable" fallback), and every set* resolves as a no-op write.
    cache = {
      getVersion: jest.fn().mockRejectedValue(new Error('no redis in unit test')),
      getResolution: jest.fn(),
      setResolution: jest.fn().mockResolvedValue(undefined),
      getWidening: jest.fn().mockRejectedValue(new Error('no redis in unit test')),
      setWidening: jest.fn().mockResolvedValue(undefined),
    };
    controller = new FoldersController(cls, folders, groups, documents, cache);
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
  });

  describe('create (Phase 2 plan Task 4)', () => {
    it('rejects a non-admin creating a root folder', async () => {
      await expect(controller.create({ parentId: null, name: 'Root' })).rejects.toThrow(ForbiddenException);
      expect(folders.createFolder).not.toHaveBeenCalled();
    });

    it('lets an admin create a root folder', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });

      const result = await controller.create({ parentId: null, name: 'Root' });

      expect(folders.createFolder).toHaveBeenCalledWith({ name: 'Root', parentId: null });
      expect(result.parentId).toBeNull();
    });

    it('404s creating under a parent the caller can only read (not edit)', async () => {
      const parent = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'read' }] });
      folders.findAllForTenant.mockResolvedValue([parent]);

      await expect(controller.create({ parentId: parent._id.toString(), name: 'Child' })).rejects.toThrow(NotFoundException);
      expect(folders.createFolder).not.toHaveBeenCalled();
    });

    it('creates under a parent the caller can edit', async () => {
      const parent = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] });
      folders.findAllForTenant.mockResolvedValue([parent]);

      await controller.create({ parentId: parent._id.toString(), name: 'Child' });

      expect(folders.createFolder).toHaveBeenCalledWith({ name: 'Child', parentId: parent._id });
    });

    it('rejects a malformed body', async () => {
      await expect(controller.create({ parentId: null, name: '' })).rejects.toThrow(ZodError);
      expect(folders.createFolder).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('404s below manage tier (edit alone is not enough)', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      await expect(controller.rename(folder._id.toString(), { name: 'New name' })).rejects.toThrow(NotFoundException);
      expect(folders.renameFolder).not.toHaveBeenCalled();
    });

    it('renames at manage tier', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);
      folders.renameFolder.mockResolvedValue({ ...folder, name: 'New name' });

      const result = await controller.rename(folder._id.toString(), { name: 'New name' });

      expect(folders.renameFolder).toHaveBeenCalledWith(folder._id, 'New name');
      expect(result.name).toBe('New name');
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

    it('lets an admin move a folder to root', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const folder = folderDoc();
      folders.findAllForTenant.mockResolvedValue([folder]);
      folders.moveFolder.mockResolvedValue({ ...folder, parentId: null });

      await controller.move(folder._id.toString(), { parentId: null });

      expect(folders.moveFolder).toHaveBeenCalledWith(folder._id, null);
    });

    it('404s moving into a destination the caller cannot edit', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      const destination = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'read' }] });
      folders.findAllForTenant.mockResolvedValue([folder, destination]);

      await expect(controller.move(folder._id.toString(), { parentId: destination._id.toString() })).rejects.toThrow(NotFoundException);
      expect(folders.moveFolder).not.toHaveBeenCalled();
    });

    it('moves into a destination the caller can edit', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      const destination = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] });
      folders.findAllForTenant.mockResolvedValue([folder, destination]);
      folders.moveFolder.mockResolvedValue({ ...folder, parentId: destination._id });

      await controller.move(folder._id.toString(), { parentId: destination._id.toString() });

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

    it('deletes an empty folder at manage tier', async () => {
      const folder = folderDoc({ hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] });
      folders.findAllForTenant.mockResolvedValue([folder]);

      const result = await controller.remove(folder._id.toString());

      expect(folders.deleteOne).toHaveBeenCalledWith({ _id: folder._id });
      expect(result).toEqual({ deleted: true });
    });
  });
});
