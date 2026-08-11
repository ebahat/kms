import { NotFoundException } from '@nestjs/common';
import { newObjectId } from '@kms/data';
import { TasksController } from './tasks.controller';

describe('TasksController (Phase 2A kanban, ADR-0012 @Module(\'kanban\'))', () => {
  const tenantId = newObjectId();
  const userId = newObjectId();
  const groupId = newObjectId();

  let cls: any;
  let tasks: any;
  let membership: any;
  let auditEvents: any;
  let notifications: any;
  let controller: TasksController;

  beforeEach(() => {
    cls = { get: jest.fn().mockReturnValue({ tenantId, userId, role: 'user', edition: 'kb', featureToggles: ['kanban'] }) };
    tasks = {
      findForGroup: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((doc) => Promise.resolve({ _id: newObjectId(), ...doc })),
      findById: jest.fn(),
      updateOne: jest.fn().mockResolvedValue(undefined),
      deleteOne: jest.fn().mockResolvedValue(undefined),
    };
    membership = { isMember: jest.fn().mockResolvedValue(true) };
    auditEvents = { record: jest.fn().mockResolvedValue(undefined) };
    notifications = {
      notifyTaskAssigned: jest.fn().mockResolvedValue(undefined),
      notifyTaskAdded: jest.fn().mockResolvedValue(undefined),
      notifyTaskDeleted: jest.fn().mockResolvedValue(undefined),
      notifyTaskStatusChanged: jest.fn().mockResolvedValue(undefined),
    };
    controller = new TasksController(cls, tasks, membership, auditEvents, notifications);
  });

  describe('list', () => {
    it('returns tasks for a member', async () => {
      await controller.list(groupId.toString());
      expect(membership.isMember).toHaveBeenCalledWith(groupId.toString());
      expect(tasks.findForGroup).toHaveBeenCalledWith(groupId);
    });

    it('returns 404 (never 403) for a non-member', async () => {
      membership.isMember.mockResolvedValue(false);
      await expect(controller.list(groupId.toString())).rejects.toThrow(NotFoundException);
      expect(tasks.findForGroup).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    const body = { title: 'Write report' };

    it('creates a task for a member in the todo column and records an audit event', async () => {
      const result = await controller.create(groupId.toString(), body);

      expect(tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({ groupId, title: 'Write report', column: 'todo', createdBy: userId }),
      );
      expect(auditEvents.record).toHaveBeenCalledWith({
        action: 'kanban.task.created',
        targetId: result._id,
        metadata: { groupId: groupId.toString() },
      });
    });

    it('sends the assignment notification when created with an assignee', async () => {
      const assigneeUserId = newObjectId().toString();
      const result = await controller.create(groupId.toString(), { ...body, assigneeUserId });
      expect(notifications.notifyTaskAssigned).toHaveBeenCalledWith(result);
    });

    it('does not send a notification when created without an assignee', async () => {
      await controller.create(groupId.toString(), body);
      expect(notifications.notifyTaskAssigned).not.toHaveBeenCalled();
    });

    it('sends the preference-gated taskAdded notification regardless of assignee', async () => {
      const result = await controller.create(groupId.toString(), body);
      expect(notifications.notifyTaskAdded).toHaveBeenCalledWith(result);
    });

    it('returns 404 (never 403) for a non-member and never creates the task', async () => {
      membership.isMember.mockResolvedValue(false);
      await expect(controller.create(groupId.toString(), body)).rejects.toThrow(NotFoundException);
      expect(tasks.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const taskId = newObjectId();

    beforeEach(() => {
      tasks.findById.mockResolvedValue({ _id: taskId, groupId, column: 'todo' });
    });

    it('moves a task to a new column, records a statusChanged audit event, sends the statusChanged notification, and sends no assignment notification', async () => {
      await controller.update(groupId.toString(), taskId.toString(), { column: 'in_progress' });

      expect(tasks.updateOne).toHaveBeenCalledWith({ _id: taskId }, { $set: { column: 'in_progress' } });
      expect(auditEvents.record).toHaveBeenCalledWith({
        action: 'kanban.task.statusChanged',
        targetId: taskId,
        metadata: { groupId: groupId.toString(), from: 'todo', to: 'in_progress' },
      });
      expect(notifications.notifyTaskStatusChanged).toHaveBeenCalled();
      expect(notifications.notifyTaskAssigned).not.toHaveBeenCalled();
    });

    it('does not record a statusChanged audit event when the column is unchanged', async () => {
      await controller.update(groupId.toString(), taskId.toString(), { column: 'todo' });
      expect(auditEvents.record).not.toHaveBeenCalled();
    });

    it('reassigns a task, sends the assignment notification, and records no statusChanged audit event', async () => {
      const assigneeUserId = newObjectId().toString();
      const updated = { _id: taskId, groupId, column: 'todo', assigneeUserId: newObjectId() };
      tasks.findById.mockResolvedValueOnce({ _id: taskId, groupId, column: 'todo' }).mockResolvedValueOnce(updated).mockResolvedValueOnce(updated);

      await controller.update(groupId.toString(), taskId.toString(), { assigneeUserId });

      expect(tasks.updateOne).toHaveBeenCalledWith({ _id: taskId }, { $set: { assigneeUserId: expect.anything() } });
      expect(notifications.notifyTaskAssigned).toHaveBeenCalledWith(updated);
      expect(auditEvents.record).not.toHaveBeenCalled();
    });

    it('records both statusChanged and sends a notification when column and assignee change together', async () => {
      const assigneeUserId = newObjectId().toString();
      const updated = { _id: taskId, groupId, column: 'done', assigneeUserId: newObjectId() };
      tasks.findById.mockResolvedValueOnce({ _id: taskId, groupId, column: 'todo' }).mockResolvedValueOnce(updated).mockResolvedValueOnce(updated);

      await controller.update(groupId.toString(), taskId.toString(), { column: 'done', assigneeUserId });

      expect(auditEvents.record).toHaveBeenCalledWith({
        action: 'kanban.task.statusChanged',
        targetId: taskId,
        metadata: { groupId: groupId.toString(), from: 'todo', to: 'done' },
      });
      expect(notifications.notifyTaskStatusChanged).toHaveBeenCalledWith(updated);
      expect(notifications.notifyTaskAssigned).toHaveBeenCalledWith(updated);
    });

    it('returns 404 (never 403) for a non-member', async () => {
      membership.isMember.mockResolvedValue(false);
      await expect(controller.update(groupId.toString(), taskId.toString(), { column: 'done' })).rejects.toThrow(NotFoundException);
      expect(tasks.updateOne).not.toHaveBeenCalled();
    });

    it('returns 404 for a task that does not exist', async () => {
      tasks.findById.mockResolvedValue(null);
      await expect(controller.update(groupId.toString(), taskId.toString(), { column: 'done' })).rejects.toThrow(NotFoundException);
    });

    it('returns 404 for a taskId that belongs to a different group', async () => {
      tasks.findById.mockResolvedValue({ _id: taskId, groupId: newObjectId() });
      await expect(controller.update(groupId.toString(), taskId.toString(), { column: 'done' })).rejects.toThrow(NotFoundException);
      expect(tasks.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    const taskId = newObjectId();

    beforeEach(() => {
      tasks.findById.mockResolvedValue({ _id: taskId, groupId });
    });

    it('deletes a task for a member and records an audit event', async () => {
      const result = await controller.remove(groupId.toString(), taskId.toString());

      expect(tasks.deleteOne).toHaveBeenCalledWith({ _id: taskId });
      expect(auditEvents.record).toHaveBeenCalledWith({
        action: 'kanban.task.deleted',
        targetId: taskId,
        metadata: { groupId: groupId.toString() },
      });
      expect(notifications.notifyTaskDeleted).toHaveBeenCalledWith({ _id: taskId, groupId });
      expect(result).toEqual({ deleted: true });
    });

    it('returns 404 (never 403) for a non-member and never deletes', async () => {
      membership.isMember.mockResolvedValue(false);
      await expect(controller.remove(groupId.toString(), taskId.toString())).rejects.toThrow(NotFoundException);
      expect(tasks.deleteOne).not.toHaveBeenCalled();
    });

    it('returns 404 for a task that does not exist', async () => {
      tasks.findById.mockResolvedValue(null);
      await expect(controller.remove(groupId.toString(), taskId.toString())).rejects.toThrow(NotFoundException);
    });

    it('returns 404 for a taskId that belongs to a different group', async () => {
      tasks.findById.mockResolvedValue({ _id: taskId, groupId: newObjectId() });
      await expect(controller.remove(groupId.toString(), taskId.toString())).rejects.toThrow(NotFoundException);
      expect(tasks.deleteOne).not.toHaveBeenCalled();
    });
  });
});
