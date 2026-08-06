import { newObjectId } from '@kms/data';
import { FakeNotificationProvider } from './fake-notification-provider';
import { NotificationDispatchService } from './notification-dispatch.service';

describe('NotificationDispatchService', () => {
  let fake: FakeNotificationProvider;
  let groups: any;
  let users: any;
  let service: NotificationDispatchService;

  const emailFor = (id: ReturnType<typeof newObjectId>) => `${id.toString()}@example.com`;

  beforeEach(() => {
    fake = new FakeNotificationProvider();
    groups = { findById: jest.fn() };
    users = { findById: jest.fn((id) => Promise.resolve({ _id: id, email: emailFor(id) })) };
    service = new NotificationDispatchService(fake, groups, users);
  });

  describe('notifyEventCreated', () => {
    it('emails every other group member, excluding the creator', async () => {
      const creatorId = newObjectId();
      const memberA = newObjectId();
      const memberB = newObjectId();
      const groupId = newObjectId();
      groups.findById.mockResolvedValue({ _id: groupId, memberUserIds: [creatorId, memberA, memberB] });

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
});
