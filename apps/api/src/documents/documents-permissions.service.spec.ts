import RedisMock from 'ioredis-mock';
import { MissingScopeError, newObjectId, SCOPE_CLS_KEY, Scope } from '@kms/data';
import { PermissionCache } from '@kms/permissions';
import { DocumentsPermissionsService } from './documents-permissions.service';

class FakeCls {
  private store = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  set(key: string, value: unknown) {
    this.store.set(key, value);
  }
}

function makeFolder(overrides: Record<string, unknown> = {}) {
  return { _id: newObjectId(), parentId: null, grants: [], hasExplicitGrants: true, isPublic: false, ...overrides };
}

describe('DocumentsPermissionsService (first real consumer of libs/permissions)', () => {
  let cls: FakeCls;
  let cache: PermissionCache;
  const tenantId = newObjectId();
  const userId = newObjectId();

  beforeEach(async () => {
    cls = new FakeCls();
    const redis = new RedisMock();
    await redis.flushall();
    cache = new PermissionCache(redis as any);
  });

  function setScope(role: Scope['role'] = 'user') {
    cls.set(SCOPE_CLS_KEY, { tenantId, userId, role, edition: 'kb' } as Scope);
  }

  it('throws MissingScopeError when called with no authenticated scope', async () => {
    const folders = { findAllForTenant: jest.fn() };
    const groups = { findForMember: jest.fn() };
    const service = new DocumentsPermissionsService(cls as any, folders as any, groups as any, cache);
    await expect(service.canUploadTo('anything')).rejects.toThrow(MissingScopeError);
  });

  it('returns false for a folderId that does not exist in the tenant, even for an admin', async () => {
    setScope('admin');
    const folders = { findAllForTenant: jest.fn().mockResolvedValue([]) };
    const groups = { findForMember: jest.fn() };
    const service = new DocumentsPermissionsService(cls as any, folders as any, groups as any, cache);

    expect(await service.canUploadTo(newObjectId().toString())).toBe(false);
  });

  it('a tenant admin can upload to any existing folder regardless of grants', async () => {
    setScope('admin');
    const folder = makeFolder({ grants: [] }); // no grants at all
    const folders = { findAllForTenant: jest.fn().mockResolvedValue([folder]) };
    const groups = { findForMember: jest.fn() };
    const service = new DocumentsPermissionsService(cls as any, folders as any, groups as any, cache);

    expect(await service.canUploadTo(folder._id.toString())).toBe(true);
    expect(groups.findForMember).not.toHaveBeenCalled(); // admin bypass skips the resolver entirely
  });

  it('a regular user with an edit grant can upload', async () => {
    setScope('user');
    const folder = makeFolder({ grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] });
    const folders = { findAllForTenant: jest.fn().mockResolvedValue([folder]) };
    const groups = { findForMember: jest.fn().mockResolvedValue([]) };
    const service = new DocumentsPermissionsService(cls as any, folders as any, groups as any, cache);

    expect(await service.canUploadTo(folder._id.toString())).toBe(true);
  });

  it('a regular user with only a read grant cannot upload', async () => {
    setScope('user');
    const folder = makeFolder({ grants: [{ principalType: 'user', principalId: userId, access: 'read' }] });
    const folders = { findAllForTenant: jest.fn().mockResolvedValue([folder]) };
    const groups = { findForMember: jest.fn().mockResolvedValue([]) };
    const service = new DocumentsPermissionsService(cls as any, folders as any, groups as any, cache);

    expect(await service.canUploadTo(folder._id.toString())).toBe(false);
  });

  it('a regular user with no grant on the folder cannot upload', async () => {
    setScope('user');
    const folder = makeFolder({ grants: [] });
    const folders = { findAllForTenant: jest.fn().mockResolvedValue([folder]) };
    const groups = { findForMember: jest.fn().mockResolvedValue([]) };
    const service = new DocumentsPermissionsService(cls as any, folders as any, groups as any, cache);

    expect(await service.canUploadTo(folder._id.toString())).toBe(false);
  });

  it('a regular user can upload via an edit grant on a group they belong to', async () => {
    setScope('user');
    const groupId = newObjectId();
    const folder = makeFolder({ grants: [{ principalType: 'group', principalId: groupId, access: 'edit' }] });
    const folders = { findAllForTenant: jest.fn().mockResolvedValue([folder]) };
    const groups = { findForMember: jest.fn().mockResolvedValue([{ _id: groupId }]) };
    const service = new DocumentsPermissionsService(cls as any, folders as any, groups as any, cache);

    expect(await service.canUploadTo(folder._id.toString())).toBe(true);
  });

  describe('canRead (download path, Phase 2.4)', () => {
    it('a regular user with only a read grant can read (unlike canUploadTo)', async () => {
      setScope('user');
      const folder = makeFolder({ grants: [{ principalType: 'user', principalId: userId, access: 'read' }] });
      const folders = { findAllForTenant: jest.fn().mockResolvedValue([folder]) };
      const groups = { findForMember: jest.fn().mockResolvedValue([]) };
      const service = new DocumentsPermissionsService(cls as any, folders as any, groups as any, cache);

      expect(await service.canRead(folder._id.toString())).toBe(true);
    });

    it('a regular user with no grant at all cannot read', async () => {
      setScope('user');
      const folder = makeFolder({ grants: [] });
      const folders = { findAllForTenant: jest.fn().mockResolvedValue([folder]) };
      const groups = { findForMember: jest.fn().mockResolvedValue([]) };
      const service = new DocumentsPermissionsService(cls as any, folders as any, groups as any, cache);

      expect(await service.canRead(folder._id.toString())).toBe(false);
    });

    it('a tenant admin can read any existing folder regardless of grants', async () => {
      setScope('admin');
      const folder = makeFolder({ grants: [] });
      const folders = { findAllForTenant: jest.fn().mockResolvedValue([folder]) };
      const groups = { findForMember: jest.fn() };
      const service = new DocumentsPermissionsService(cls as any, folders as any, groups as any, cache);

      expect(await service.canRead(folder._id.toString())).toBe(true);
    });

    it('returns false for a nonexistent folderId', async () => {
      setScope('user');
      const folders = { findAllForTenant: jest.fn().mockResolvedValue([]) };
      const groups = { findForMember: jest.fn() };
      const service = new DocumentsPermissionsService(cls as any, folders as any, groups as any, cache);

      expect(await service.canRead(newObjectId().toString())).toBe(false);
    });
  });
});
