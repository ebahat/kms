import { NotFoundException } from '@nestjs/common';
import { newObjectId } from '@kms/data';
import { EventsController } from './events.controller';

describe('EventsController (Phase 2A calendar, ADR-0012 @Module(\'calendar\'))', () => {
  const tenantId = newObjectId();
  const userId = newObjectId();
  const groupId = newObjectId();

  let cls: any;
  let events: any;
  let membership: any;
  let auditEvents: any;
  let notifications: any;
  let controller: EventsController;

  beforeEach(() => {
    cls = { get: jest.fn().mockReturnValue({ tenantId, userId, role: 'user', edition: 'kb', featureToggles: ['calendar'] }) };
    events = {
      findForGroup: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((doc) => Promise.resolve({ _id: newObjectId(), ...doc })),
      findById: jest.fn(),
      updateOne: jest.fn().mockResolvedValue(undefined),
      deleteOne: jest.fn().mockResolvedValue(undefined),
    };
    membership = { isMember: jest.fn().mockResolvedValue(true) };
    auditEvents = { record: jest.fn().mockResolvedValue(undefined) };
    notifications = { notifyEventCreated: jest.fn().mockResolvedValue(undefined) };
    controller = new EventsController(cls, events, membership, auditEvents, notifications);
  });

  describe('list', () => {
    it('returns events for a member', async () => {
      await controller.list(groupId.toString());
      expect(membership.isMember).toHaveBeenCalledWith(groupId.toString());
      expect(events.findForGroup).toHaveBeenCalledWith(groupId);
    });

    it('returns 404 (never 403) for a non-member', async () => {
      membership.isMember.mockResolvedValue(false);
      await expect(controller.list(groupId.toString())).rejects.toThrow(NotFoundException);
      expect(events.findForGroup).not.toHaveBeenCalled();
    });

    it('returns 404 for a groupId belonging to another tenant (isMember false via GroupsRepository tenant scoping)', async () => {
      membership.isMember.mockResolvedValue(false);
      await expect(controller.list(newObjectId().toString())).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    const body = { title: 'Team sync', startAt: '2026-08-10T10:00:00Z', endAt: '2026-08-10T11:00:00Z' };

    it('creates an event for a member, records an audit event, and sends the invite notification', async () => {
      const result = await controller.create(groupId.toString(), body);

      expect(events.create).toHaveBeenCalledWith(
        expect.objectContaining({ groupId, title: 'Team sync', createdBy: userId }),
      );
      expect(auditEvents.record).toHaveBeenCalledWith({
        action: 'calendar.event.created',
        targetId: result._id,
        metadata: { groupId: groupId.toString() },
      });
      expect(notifications.notifyEventCreated).toHaveBeenCalledWith(result);
    });

    it('returns 404 (never 403) for a non-member and never creates the event', async () => {
      membership.isMember.mockResolvedValue(false);
      await expect(controller.create(groupId.toString(), body)).rejects.toThrow(NotFoundException);
      expect(events.create).not.toHaveBeenCalled();
      expect(notifications.notifyEventCreated).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const eventId = newObjectId();

    beforeEach(() => {
      events.findById.mockResolvedValue({ _id: eventId, groupId, title: 'Old title' });
    });

    it('updates an event for a member and records an audit event, without sending a notification', async () => {
      await controller.update(groupId.toString(), eventId.toString(), { title: 'New title' });

      expect(events.updateOne).toHaveBeenCalledWith({ _id: eventId }, { title: 'New title' });
      expect(auditEvents.record).toHaveBeenCalledWith({
        action: 'calendar.event.updated',
        targetId: eventId,
        metadata: { groupId: groupId.toString() },
      });
      expect(notifications.notifyEventCreated).not.toHaveBeenCalled();
    });

    it('returns 404 (never 403) for a non-member', async () => {
      membership.isMember.mockResolvedValue(false);
      await expect(controller.update(groupId.toString(), eventId.toString(), { title: 'x' })).rejects.toThrow(NotFoundException);
      expect(events.updateOne).not.toHaveBeenCalled();
    });

    it('returns 404 for an event that does not exist', async () => {
      events.findById.mockResolvedValue(null);
      await expect(controller.update(groupId.toString(), eventId.toString(), { title: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('returns 404 for an eventId that belongs to a different group', async () => {
      events.findById.mockResolvedValue({ _id: eventId, groupId: newObjectId() });
      await expect(controller.update(groupId.toString(), eventId.toString(), { title: 'x' })).rejects.toThrow(NotFoundException);
      expect(events.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    const eventId = newObjectId();

    beforeEach(() => {
      events.findById.mockResolvedValue({ _id: eventId, groupId });
    });

    it('deletes an event for a member and records an audit event', async () => {
      const result = await controller.remove(groupId.toString(), eventId.toString());

      expect(events.deleteOne).toHaveBeenCalledWith({ _id: eventId });
      expect(auditEvents.record).toHaveBeenCalledWith({
        action: 'calendar.event.deleted',
        targetId: eventId,
        metadata: { groupId: groupId.toString() },
      });
      expect(result).toEqual({ deleted: true });
    });

    it('returns 404 (never 403) for a non-member and never deletes', async () => {
      membership.isMember.mockResolvedValue(false);
      await expect(controller.remove(groupId.toString(), eventId.toString())).rejects.toThrow(NotFoundException);
      expect(events.deleteOne).not.toHaveBeenCalled();
    });

    it('returns 404 for an event that does not exist', async () => {
      events.findById.mockResolvedValue(null);
      await expect(controller.remove(groupId.toString(), eventId.toString())).rejects.toThrow(NotFoundException);
    });

    it('returns 404 for an eventId that belongs to a different group', async () => {
      events.findById.mockResolvedValue({ _id: eventId, groupId: newObjectId() });
      await expect(controller.remove(groupId.toString(), eventId.toString())).rejects.toThrow(NotFoundException);
      expect(events.deleteOne).not.toHaveBeenCalled();
    });
  });
});
