import { BadRequestException, NotFoundException } from '@nestjs/common';
import { newObjectId } from '@kms/data';
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
  let cache: any;
  let controller: FoldersController;

  beforeEach(() => {
    cls = { get: jest.fn().mockReturnValue({ tenantId, userId, role: 'user', edition: 'kb', featureToggles: [] }) };
    folders = { findAllForTenant: jest.fn().mockResolvedValue([]) };
    groups = { findForMember: jest.fn().mockResolvedValue([]), findAllForTenant: jest.fn().mockResolvedValue([]) };
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
    controller = new FoldersController(cls, folders, groups, cache);
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
});
