import { NotificationPreferenceField, PreferenceScope, newObjectId } from '@kms/data';
import { FakeNotificationProvider } from './fake-notification-provider';
import { NotificationDispatchService } from './notification-dispatch.service';

describe('NotificationDispatchService', () => {
  let fake: FakeNotificationProvider;
  let groups: any;
  let users: any;
  let preferences: any;
  let folders: any;
  let cls: any;
  let service: NotificationDispatchService;

  const emailFor = (id: ReturnType<typeof newObjectId>) => `${id.toString()}@example.com`;
  const actorUserId = newObjectId();

  const preference = (overrides: Partial<Record<NotificationPreferenceField, PreferenceScope>> = {}) => ({
    fileAdded: 'off',
    fileDeleted: 'off',
    taskAdded: 'off',
    taskDeleted: 'off',
    taskStatusChanged: 'off',
    ...overrides,
  });

  beforeEach(() => {
    fake = new FakeNotificationProvider();
    groups = { findById: jest.fn(), findForMember: jest.fn().mockResolvedValue([]) };
    users = { findById: jest.fn((id) => Promise.resolve({ _id: id, email: emailFor(id) })) };
    preferences = {
      findOrCreateForUser: jest.fn().mockResolvedValue(preference()),
      findAllWithPreference: jest.fn().mockResolvedValue([]),
    };
    folders = { findAllForTenant: jest.fn().mockResolvedValue([]) };
    cls = { get: jest.fn().mockReturnValue({ tenantId: newObjectId(), userId: actorUserId, role: 'user' }) };
    service = new NotificationDispatchService(fake, groups, users, preferences, folders, cls);
  });

  describe('notifyEventCreated', () => {
    it('emails every other group member, excluding the creator', async () => {
      const creatorId = newObjectId();
      const memberA = newObjectId();
      const memberB = newObjectId();
      const groupId = newObjectId();
      groups.findById.mockResolvedValue({ _id: groupId, members: [creatorId, memberA, memberB].map((userId) => ({ userId, role: 'editor' })) });

      const event = {
        _id: newObjectId(),
        groupId,
        title: 'Team sync',
        startAt: new Date('2026-08-10T10:00:00Z'),
        createdBy: creatorId,
      } as any;

      await service.notifyEventCreated(event);

      expect(fake.sent).toHaveLength(2);
      expect(fake.sent.map((s) => s.to).sort()).toEqual([emailFor(memberA), emailFor(memberB)].sort());
      expect(fake.sent.every((s) => s.to !== emailFor(creatorId))).toBe(true);
    });

    it('is a no-op when the group no longer exists', async () => {
      groups.findById.mockResolvedValue(null);
      const event = { _id: newObjectId(), groupId: newObjectId(), title: 'x', startAt: new Date(), createdBy: newObjectId() } as any;

      await service.notifyEventCreated(event);

      expect(fake.sent).toHaveLength(0);
    });
  });

  describe('notifyTaskAssigned', () => {
    it('emails only the assignee', async () => {
      const assigneeId = newObjectId();
      const task = { _id: newObjectId(), title: 'Write report', assigneeUserId: assigneeId, dueDate: undefined } as any;

      await service.notifyTaskAssigned(task);

      expect(fake.sent).toHaveLength(1);
      expect(fake.sent[0]).toMatchObject({ to: emailFor(assigneeId), subject: 'Assigned: Write report' });
    });

    it('is a no-op, not an error, when the task has no assignee', async () => {
      const task = { _id: newObjectId(), title: 'Unassigned task', assigneeUserId: undefined } as any;

      await expect(service.notifyTaskAssigned(task)).resolves.toBeUndefined();
      expect(fake.sent).toHaveLength(0);
      expect(groups.findById).not.toHaveBeenCalled();
    });
  });

  describe('notifyFileAdded / notifyFileDeleted (preference-gated, folder-scoped)', () => {
    const folderId = newObjectId();
    const document = { _id: newObjectId(), folderId, name: 'report.pdf', createdBy: newObjectId() } as any;

    it('sends nothing when the owner is "off" and nobody has "all"', async () => {
      preferences.findOrCreateForUser.mockResolvedValue(preference({ fileAdded: 'off' }));

      await service.notifyFileAdded(document);

      expect(fake.sent).toHaveLength(0);
    });

    it('emails the owner when their preference is "mine" and they are not the actor', async () => {
      preferences.findOrCreateForUser.mockResolvedValue(preference({ fileAdded: 'mine' }));

      await service.notifyFileAdded(document);

      expect(fake.sent).toHaveLength(1);
      expect(fake.sent[0]).toMatchObject({ to: emailFor(document.createdBy) });
    });

    it('does not email the owner when the owner is the actor, even with "mine"', async () => {
      const selfDocument = { ...document, createdBy: actorUserId };
      preferences.findOrCreateForUser.mockResolvedValue(preference({ fileAdded: 'mine' }));

      await service.notifyFileDeleted(selfDocument);

      expect(fake.sent).toHaveLength(0);
    });

    it('emails an "all" user who belongs to a group with a grant on the folder', async () => {
      const allUserId = newObjectId();
      const groupWithAccess = newObjectId();
      preferences.findAllWithPreference.mockResolvedValue([{ userId: allUserId, fileAdded: 'all' }]);
      groups.findForMember.mockResolvedValue([{ _id: groupWithAccess }]);
      folders.findAllForTenant.mockResolvedValue([
        { _id: folderId, grants: [{ principalType: 'group', principalId: groupWithAccess, access: 'read' }] },
      ]);

      await service.notifyFileAdded(document);

      expect(fake.sent.map((s) => s.to)).toContain(emailFor(allUserId));
    });

    it('does not email an "all" user whose groups have no grant on this folder', async () => {
      const allUserId = newObjectId();
      const unrelatedGroup = newObjectId();
      preferences.findAllWithPreference.mockResolvedValue([{ userId: allUserId, fileAdded: 'all' }]);
      groups.findForMember.mockResolvedValue([{ _id: unrelatedGroup }]);
      folders.findAllForTenant.mockResolvedValue([{ _id: folderId, grants: [] }]);

      await service.notifyFileAdded(document);

      expect(fake.sent).toHaveLength(0);
    });

    it('never emails the actor, even when the actor is an "all" recipient', async () => {
      const groupWithAccess = newObjectId();
      preferences.findAllWithPreference.mockResolvedValue([{ userId: actorUserId, fileAdded: 'all' }]);
      groups.findForMember.mockResolvedValue([{ _id: groupWithAccess }]);
      folders.findAllForTenant.mockResolvedValue([
        { _id: folderId, grants: [{ principalType: 'group', principalId: groupWithAccess, access: 'read' }] },
      ]);

      await service.notifyFileAdded(document);

      expect(fake.sent).toHaveLength(0);
    });

    it('dedupes when the owner qualifies via both "mine" and group-based "all"', async () => {
      const groupWithAccess = newObjectId();
      preferences.findOrCreateForUser.mockResolvedValue(preference({ fileAdded: 'mine' }));
      preferences.findAllWithPreference.mockResolvedValue([{ userId: document.createdBy, fileAdded: 'all' }]);
      groups.findForMember.mockResolvedValue([{ _id: groupWithAccess }]);
      folders.findAllForTenant.mockResolvedValue([
        { _id: folderId, grants: [{ principalType: 'group', principalId: groupWithAccess, access: 'read' }] },
      ]);

      await service.notifyFileAdded(document);

      expect(fake.sent).toHaveLength(1);
    });
  });

  describe('notifyTaskAdded / notifyTaskDeleted / notifyTaskStatusChanged (preference-gated, group-scoped)', () => {
    const groupId = newObjectId();
    const assigneeUserId = newObjectId();
    const task = { _id: newObjectId(), groupId, title: 'Write report', column: 'todo', assigneeUserId, createdBy: newObjectId() } as any;

    it('sends nothing when "off" and nobody has "all"', async () => {
      preferences.findOrCreateForUser.mockResolvedValue(preference({ taskAdded: 'off' }));

      await service.notifyTaskAdded(task);

      expect(fake.sent).toHaveLength(0);
    });

    it('emails the assignee when their preference is "mine"', async () => {
      preferences.findOrCreateForUser.mockResolvedValue(preference({ taskAdded: 'mine' }));

      await service.notifyTaskAdded(task);

      expect(fake.sent).toHaveLength(1);
      expect(fake.sent[0]).toMatchObject({ to: emailFor(assigneeUserId) });
    });

    it('falls back to the creator for "mine" when the task is unassigned', async () => {
      const unassigned = { ...task, assigneeUserId: undefined };
      preferences.findOrCreateForUser.mockResolvedValue(preference({ taskDeleted: 'mine' }));

      await service.notifyTaskDeleted(unassigned);

      expect(fake.sent).toHaveLength(1);
      expect(fake.sent[0]).toMatchObject({ to: emailFor(task.createdBy) });
    });

    it('emails every "all" group member except the actor', async () => {
      const allMember = newObjectId();
      groups.findById.mockResolvedValue({ _id: groupId, members: [allMember, actorUserId].map((userId) => ({ userId, role: 'editor' })) });
      preferences.findAllWithPreference.mockResolvedValue([{ userId: allMember, taskStatusChanged: 'all' }]);

      await service.notifyTaskStatusChanged(task);

      expect(fake.sent.map((s) => s.to)).toEqual([emailFor(allMember)]);
    });

    it('never emails the actor', async () => {
      groups.findById.mockResolvedValue({ _id: groupId, members: [{ userId: actorUserId, role: 'editor' }] });
      preferences.findAllWithPreference.mockResolvedValue([{ userId: actorUserId, taskAdded: 'all' }]);

      await service.notifyTaskAdded(task);

      expect(fake.sent).toHaveLength(0);
    });
  });
});
