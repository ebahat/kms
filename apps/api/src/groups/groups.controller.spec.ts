import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ZodError } from 'zod';
import { newObjectId } from '@kms/data';
import { GroupsController } from './groups.controller';

function groupDoc(overrides: Partial<Record<string, any>> = {}) {
  return { _id: newObjectId(), name: 'Group', members: [], ...overrides };
}

function folderDoc(overrides: Partial<Record<string, any>> = {}) {
  return { _id: newObjectId(), grants: [], ...overrides };
}

describe('GroupsController (Phase 2 plan Task 6)', () => {
  const tenantId = newObjectId();
  const userId = newObjectId();

  let cls: any;
  let groups: any;
  let users: any;
  let folders: any;
  let events: any;
  let tasks: any;
  let auditEvents: any;
  let cache: any;
  let controller: GroupsController;

  beforeEach(() => {
    cls = { get: jest.fn().mockReturnValue({ tenantId, userId, role: 'user', edition: 'kb', featureToggles: [] }) };
    groups = {
      findAllForTenant: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findOneByName: jest.fn().mockResolvedValue(null),
      createGroup: jest.fn(),
      rename: jest.fn(),
      setMember: jest.fn(),
      removeMembers: jest.fn(),
      deleteOne: jest.fn().mockResolvedValue(undefined),
    };
    users = { find: jest.fn().mockResolvedValue([]) };
    folders = { findAllForTenant: jest.fn().mockResolvedValue([]) };
    events = { findForGroup: jest.fn().mockResolvedValue([]) };
    tasks = { findForGroup: jest.fn().mockResolvedValue([]) };
    auditEvents = { record: jest.fn().mockResolvedValue(undefined) };
    cache = { bumpVersion: jest.fn().mockResolvedValue(1) };
    controller = new GroupsController(cls, groups, users, folders, events, tasks, auditEvents, cache);
  });

  describe('list', () => {
    it('returns every group as a summary, including members (with role) for a group the caller belongs to', async () => {
      const group = groupDoc({ members: [{ userId, role: 'editor' }] });
      groups.findAllForTenant.mockResolvedValue([group]);

      const result = await controller.list();

      expect(result).toEqual([
        { id: group._id.toString(), name: 'Group', members: [{ userId: userId.toString(), role: 'editor', email: '', firstName: undefined, lastName: undefined }] },
      ]);
    });

    it('withholds members for a group the non-admin caller does not belong to', async () => {
      const other = newObjectId();
      const group = groupDoc({ members: [{ userId: other, role: 'viewer' }] });
      groups.findAllForTenant.mockResolvedValue([group]);

      const result = await controller.list();

      expect(result).toEqual([{ id: group._id.toString(), name: 'Group' }]);
    });

    it('includes members for every group when the caller is a tenant admin', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const other = newObjectId();
      const group = groupDoc({ members: [{ userId: other, role: 'manager' }] });
      groups.findAllForTenant.mockResolvedValue([group]);

      const result = await controller.list();

      expect(result).toEqual([
        { id: group._id.toString(), name: 'Group', members: [{ userId: other.toString(), role: 'manager', email: '', firstName: undefined, lastName: undefined }] },
      ]);
    });

    it('resolves each member’s email/name from a single batched users lookup across every group (2026-08-29)', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const member = newObjectId();
      const group = groupDoc({ members: [{ userId: member, role: 'editor' }] });
      groups.findAllForTenant.mockResolvedValue([group]);
      users.find.mockResolvedValue([{ _id: member, email: 'dana@example.com', firstName: 'Dana', lastName: 'Cohen' }]);

      const result = await controller.list();

      expect(users.find).toHaveBeenCalledTimes(1);
      expect(users.find).toHaveBeenCalledWith({ _id: { $in: [member] } });
      expect((result[0] as any).members).toEqual([{ userId: member.toString(), role: 'editor', email: 'dana@example.com', firstName: 'Dana', lastName: 'Cohen' }]);
    });
  });

  describe('detail', () => {
    it('404s a malformed id', async () => {
      await expect(controller.detail('not-an-object-id')).rejects.toThrow(NotFoundException);
      expect(groups.findById).not.toHaveBeenCalled();
    });

    it('404s a nonexistent group', async () => {
      groups.findById.mockResolvedValue(null);
      await expect(controller.detail(newObjectId().toString())).rejects.toThrow(NotFoundException);
    });

    it('returns the group summary', async () => {
      const group = groupDoc();
      groups.findById.mockResolvedValue(group);

      const result = await controller.detail(group._id.toString());

      expect(result.id).toBe(group._id.toString());
    });
  });

  describe('create', () => {
    // Admin-only enforcement is @UseGuards(AdminOnlyGuard) — a route-metadata decorator that only
    // takes effect through Nest's real HTTP pipeline, not a direct method call. No spec in this
    // codebase unit-tests that (documents.controller.spec.ts's admin-only restore/purgeEarly routes
    // don't either); it's a integration/HTTP-level concern, out of this plan's stated scope.

    it('creates a group and records an audit event', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const created = groupDoc({ name: 'Sales' });
      groups.createGroup.mockResolvedValue(created);

      const result = await controller.create({ name: 'Sales' });

      expect(groups.createGroup).toHaveBeenCalledWith('Sales');
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'group.created', targetId: created._id }));
      expect(result.name).toBe('Sales');
    });

    it('rejects a malformed body', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      await expect(controller.create({ name: '' })).rejects.toThrow(ZodError);
    });

    it('409s when a group with this name already exists, and never calls createGroup', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      groups.findOneByName.mockResolvedValue(groupDoc({ name: 'Sales' }));

      await expect(controller.create({ name: 'Sales' })).rejects.toThrow(ConflictException);
      expect(groups.createGroup).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('404s a malformed id', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      await expect(controller.rename('not-an-object-id', { name: 'New Name' })).rejects.toThrow(NotFoundException);
    });

    it('404s a nonexistent group', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      groups.findById.mockResolvedValue(null);
      await expect(controller.rename(newObjectId().toString(), { name: 'New Name' })).rejects.toThrow(NotFoundException);
    });

    it('409s when another group already has the target name', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const group = groupDoc({ name: 'Old Name' });
      const other = groupDoc({ name: 'Taken' });
      groups.findById.mockResolvedValue(group);
      groups.findOneByName.mockResolvedValue(other);

      await expect(controller.rename(group._id.toString(), { name: 'Taken' })).rejects.toThrow(ConflictException);
      expect(groups.rename).not.toHaveBeenCalled();
    });

    it("allows renaming a group to its own current name (not a self-conflict)", async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const group = groupDoc({ name: 'Same Name' });
      groups.findById.mockResolvedValue(group);
      groups.findOneByName.mockResolvedValue(group); // the only "match" is the group itself
      groups.rename.mockResolvedValue(group);

      await expect(controller.rename(group._id.toString(), { name: 'Same Name' })).resolves.toBeDefined();
      expect(groups.rename).toHaveBeenCalledWith(group._id, 'Same Name');
    });

    it('renames and audits', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const group = groupDoc({ name: 'Old Name' });
      const renamed = groupDoc({ _id: group._id, name: 'New Name' });
      groups.findById.mockResolvedValue(group);
      groups.rename.mockResolvedValue(renamed);

      const result = await controller.rename(group._id.toString(), { name: 'New Name' });

      expect(result.name).toBe('New Name');
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'group.renamed', targetId: group._id }));
    });
  });

  describe('updateMembers', () => {
    it('rejects an empty add and remove', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      await expect(controller.updateMembers(newObjectId().toString(), {})).rejects.toThrow(BadRequestException);
    });

    it('404s a nonexistent group', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      groups.findById.mockResolvedValue(null);
      await expect(
        controller.updateMembers(newObjectId().toString(), { add: [{ userId: userId.toString(), role: 'viewer' }] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('adds a member with a role, bumps permVersion, and audits', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const group = groupDoc();
      const newMember = newObjectId();
      groups.findById.mockResolvedValue(group);
      groups.setMember.mockResolvedValue({ ...group, members: [{ userId: newMember, role: 'editor' }] });

      await controller.updateMembers(group._id.toString(), { add: [{ userId: newMember.toString(), role: 'editor' }] });

      expect(groups.setMember).toHaveBeenCalledWith(group._id, newMember, 'editor');
      expect(cache.bumpVersion).toHaveBeenCalledWith(tenantId.toString());
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'group.members.updated' }));
    });

    it('changing an existing member’s role goes through setMember too — bumps permVersion just like an add/remove', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const member = newObjectId();
      const group = groupDoc({ members: [{ userId: member, role: 'viewer' }] });
      groups.findById.mockResolvedValue(group);
      groups.setMember.mockResolvedValue({ ...group, members: [{ userId: member, role: 'manager' }] });

      await controller.updateMembers(group._id.toString(), { add: [{ userId: member.toString(), role: 'manager' }] });

      expect(groups.setMember).toHaveBeenCalledWith(group._id, member, 'manager');
      expect(cache.bumpVersion).toHaveBeenCalledWith(tenantId.toString());
    });

    it('removes members', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const member = newObjectId();
      const group = groupDoc({ members: [{ userId: member, role: 'viewer' }] });
      groups.findById.mockResolvedValue(group);
      groups.removeMembers.mockResolvedValue({ ...group, members: [] });

      await controller.updateMembers(group._id.toString(), { remove: [member.toString()] });

      expect(groups.removeMembers).toHaveBeenCalledWith(group._id, [member]);
      expect(groups.setMember).not.toHaveBeenCalled();
    });

    it('runs remove before add, so the same id in both nets out as added with the given role', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const same = newObjectId();
      const group = groupDoc();
      groups.findById.mockResolvedValue(group);

      const callOrder: string[] = [];
      groups.removeMembers.mockImplementation(() => {
        callOrder.push('remove');
        return Promise.resolve(group);
      });
      groups.setMember.mockImplementation(() => {
        callOrder.push('add');
        return Promise.resolve(group);
      });

      await controller.updateMembers(group._id.toString(), { add: [{ userId: same.toString(), role: 'editor' }], remove: [same.toString()] });

      expect(callOrder).toEqual(['remove', 'add']);
    });

    it('rejects a malformed body', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      await expect(controller.updateMembers(newObjectId().toString(), { add: [{ userId: 'not-an-object-id', role: 'viewer' }] })).rejects.toThrow(
        ZodError,
      );
    });

    it('rejects an invalid role', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      await expect(
        controller.updateMembers(newObjectId().toString(), { add: [{ userId: userId.toString(), role: 'owner' }] }),
      ).rejects.toThrow(ZodError);
    });
  });

  describe('remove', () => {
    it('404s a nonexistent group', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      groups.findById.mockResolvedValue(null);
      await expect(controller.remove(newObjectId().toString())).rejects.toThrow(NotFoundException);
    });

    it('rejects deleting a group that still has a folder grant', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const group = groupDoc();
      groups.findById.mockResolvedValue(group);
      folders.findAllForTenant.mockResolvedValue([folderDoc({ grants: [{ principalType: 'group', principalId: group._id, access: 'read' }] })]);

      await expect(controller.remove(group._id.toString())).rejects.toThrow(ConflictException);
      expect(groups.deleteOne).not.toHaveBeenCalled();
    });

    it('rejects deleting a group that still owns a calendar event', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const group = groupDoc();
      groups.findById.mockResolvedValue(group);
      events.findForGroup.mockResolvedValue([{ _id: newObjectId() }]);

      await expect(controller.remove(group._id.toString())).rejects.toThrow(ConflictException);
      expect(groups.deleteOne).not.toHaveBeenCalled();
    });

    it('rejects deleting a group that still owns a kanban task', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const group = groupDoc();
      groups.findById.mockResolvedValue(group);
      tasks.findForGroup.mockResolvedValue([{ _id: newObjectId() }]);

      await expect(controller.remove(group._id.toString())).rejects.toThrow(ConflictException);
      expect(groups.deleteOne).not.toHaveBeenCalled();
    });

    it('deletes an unreferenced group and audits', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const group = groupDoc();
      groups.findById.mockResolvedValue(group);

      const result = await controller.remove(group._id.toString());

      expect(groups.deleteOne).toHaveBeenCalledWith({ _id: group._id });
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'group.deleted' }));
      expect(result).toEqual({ deleted: true });
    });
  });
});
