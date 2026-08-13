import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ZodError } from 'zod';
import { newObjectId } from '@kms/data';
import { GroupsController } from './groups.controller';

function groupDoc(overrides: Partial<Record<string, any>> = {}) {
  return { _id: newObjectId(), name: 'Group', memberUserIds: [], ...overrides };
}

function folderDoc(overrides: Partial<Record<string, any>> = {}) {
  return { _id: newObjectId(), grants: [], ...overrides };
}

describe('GroupsController (Phase 2 plan Task 6)', () => {
  const tenantId = newObjectId();
  const userId = newObjectId();

  let cls: any;
  let groups: any;
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
      createGroup: jest.fn(),
      addMembers: jest.fn(),
      removeMembers: jest.fn(),
      deleteOne: jest.fn().mockResolvedValue(undefined),
    };
    folders = { findAllForTenant: jest.fn().mockResolvedValue([]) };
    events = { findForGroup: jest.fn().mockResolvedValue([]) };
    tasks = { findForGroup: jest.fn().mockResolvedValue([]) };
    auditEvents = { record: jest.fn().mockResolvedValue(undefined) };
    cache = { bumpVersion: jest.fn().mockResolvedValue(1) };
    controller = new GroupsController(cls, groups, folders, events, tasks, auditEvents, cache);
  });

  describe('list', () => {
    it('returns every group as a summary, including memberUserIds for a group the caller belongs to', async () => {
      const group = groupDoc({ memberUserIds: [userId] });
      groups.findAllForTenant.mockResolvedValue([group]);

      const result = await controller.list();

      expect(result).toEqual([{ id: group._id.toString(), name: 'Group', memberUserIds: [userId.toString()] }]);
    });

    it('withholds memberUserIds for a group the non-admin caller does not belong to', async () => {
      const other = newObjectId();
      const group = groupDoc({ memberUserIds: [other] });
      groups.findAllForTenant.mockResolvedValue([group]);

      const result = await controller.list();

      expect(result).toEqual([{ id: group._id.toString(), name: 'Group' }]);
    });

    it('includes memberUserIds for every group when the caller is a tenant admin', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const other = newObjectId();
      const group = groupDoc({ memberUserIds: [other] });
      groups.findAllForTenant.mockResolvedValue([group]);

      const result = await controller.list();

      expect(result).toEqual([{ id: group._id.toString(), name: 'Group', memberUserIds: [other.toString()] }]);
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
  });

  describe('updateMembers', () => {
    it('rejects an empty add and remove', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      await expect(controller.updateMembers(newObjectId().toString(), {})).rejects.toThrow(BadRequestException);
    });

    it('404s a nonexistent group', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      groups.findById.mockResolvedValue(null);
      await expect(controller.updateMembers(newObjectId().toString(), { add: [userId.toString()] })).rejects.toThrow(NotFoundException);
    });

    it('adds members, bumps permVersion, and audits', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const group = groupDoc();
      const newMember = newObjectId();
      groups.findById.mockResolvedValue(group);
      groups.addMembers.mockResolvedValue({ ...group, memberUserIds: [newMember] });

      await controller.updateMembers(group._id.toString(), { add: [newMember.toString()] });

      expect(groups.addMembers).toHaveBeenCalledWith(group._id, [newMember]);
      expect(cache.bumpVersion).toHaveBeenCalledWith(tenantId.toString());
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'group.members.updated' }));
    });

    it('removes members', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const member = newObjectId();
      const group = groupDoc({ memberUserIds: [member] });
      groups.findById.mockResolvedValue(group);
      groups.removeMembers.mockResolvedValue({ ...group, memberUserIds: [] });

      await controller.updateMembers(group._id.toString(), { remove: [member.toString()] });

      expect(groups.removeMembers).toHaveBeenCalledWith(group._id, [member]);
      expect(groups.addMembers).not.toHaveBeenCalled();
    });

    it('runs remove before add, so the same id in both nets out as added', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      const same = newObjectId();
      const group = groupDoc();
      groups.findById.mockResolvedValue(group);

      const callOrder: string[] = [];
      groups.removeMembers.mockImplementation(() => {
        callOrder.push('remove');
        return Promise.resolve(group);
      });
      groups.addMembers.mockImplementation(() => {
        callOrder.push('add');
        return Promise.resolve(group);
      });

      await controller.updateMembers(group._id.toString(), { add: [same.toString()], remove: [same.toString()] });

      expect(callOrder).toEqual(['remove', 'add']);
    });

    it('rejects a malformed body', async () => {
      cls.get.mockReturnValue({ tenantId, userId, role: 'admin', edition: 'kb', featureToggles: [] });
      await expect(controller.updateMembers(newObjectId().toString(), { add: ['not-an-object-id'] })).rejects.toThrow(ZodError);
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
