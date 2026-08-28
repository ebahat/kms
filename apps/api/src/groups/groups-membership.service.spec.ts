import { MissingScopeError, newObjectId, SCOPE_CLS_KEY, Scope } from '@kms/data';
import { GroupsMembershipService } from './groups-membership.service';

class FakeCls {
  private store = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  set(key: string, value: unknown) {
    this.store.set(key, value);
  }
}

describe('GroupsMembershipService', () => {
  let cls: FakeCls;
  const tenantId = newObjectId();
  const userId = newObjectId();
  const groupId = newObjectId();

  beforeEach(() => {
    cls = new FakeCls();
  });

  function setScope(role: Scope['role'] = 'user') {
    cls.set(SCOPE_CLS_KEY, { tenantId, userId, role, edition: 'kb' } as Scope);
  }

  it('throws MissingScopeError when called with no authenticated scope', async () => {
    const groups = { findById: jest.fn() };
    const service = new GroupsMembershipService(cls as any, groups as any);

    await expect(service.isMember(groupId.toString())).rejects.toThrow(MissingScopeError);
    expect(groups.findById).not.toHaveBeenCalled();
  });

  it('returns true for a user who is a member of the group', async () => {
    setScope('user');
    const groups = { findById: jest.fn().mockResolvedValue({ _id: groupId, members: [{ userId, role: 'viewer' }] }) };
    const service = new GroupsMembershipService(cls as any, groups as any);

    expect(await service.isMember(groupId.toString())).toBe(true);
  });

  it('returns false for a user who is not a member of the group', async () => {
    setScope('user');
    const groups = { findById: jest.fn().mockResolvedValue({ _id: groupId, members: [{ userId: newObjectId(), role: 'viewer' }] }) };
    const service = new GroupsMembershipService(cls as any, groups as any);

    expect(await service.isMember(groupId.toString())).toBe(false);
  });

  it('returns false, never throws, for a nonexistent or cross-tenant groupId (GroupsRepository.findById is tenant-scoped)', async () => {
    setScope('user');
    const groups = { findById: jest.fn().mockResolvedValue(null) };
    const service = new GroupsMembershipService(cls as any, groups as any);

    await expect(service.isMember(newObjectId().toString())).resolves.toBe(false);
  });

  it('a tenant admin bypasses membership for a group that exists', async () => {
    setScope('admin');
    const groups = { findById: jest.fn().mockResolvedValue({ _id: groupId, members: [] }) };
    const service = new GroupsMembershipService(cls as any, groups as any);

    expect(await service.isMember(groupId.toString())).toBe(true);
  });

  it('admin bypass does not apply to a nonexistent group — still returns false, not true', async () => {
    setScope('admin');
    const groups = { findById: jest.fn().mockResolvedValue(null) };
    const service = new GroupsMembershipService(cls as any, groups as any);

    expect(await service.isMember(newObjectId().toString())).toBe(false);
  });
});
