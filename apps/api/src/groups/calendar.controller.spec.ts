import { NotFoundException } from '@nestjs/common';
import { newObjectId } from '@kms/data';
import { CalendarController } from './calendar.controller';

describe("CalendarController (Phase 2A merged read, requires only @Module('calendar'))", () => {
  const tenantId = newObjectId();
  const userId = newObjectId();
  const groupId = newObjectId();

  let cls: any;
  let events: any;
  let tasks: any;
  let membership: any;
  let controller: CalendarController;

  const from = '2026-08-01T00:00:00Z';
  const to = '2026-08-31T23:59:59Z';

  beforeEach(() => {
    cls = { get: jest.fn().mockReturnValue({ tenantId, userId, role: 'user', edition: 'kb', featureToggles: ['calendar', 'kanban'] }) };
    events = { findForGroupInRange: jest.fn().mockResolvedValue([{ _id: newObjectId(), title: 'Event A' }]) };
    tasks = { findWithDueDateInRange: jest.fn().mockResolvedValue([{ _id: newObjectId(), title: 'Task A' }]) };
    membership = { isMember: jest.fn().mockResolvedValue(true) };
    controller = new CalendarController(cls, events, tasks, membership);
  });

  it('returns merged events and tasks for a member when kanban is enabled', async () => {
    const result = await controller.list(groupId.toString(), from, to);

    expect(membership.isMember).toHaveBeenCalledWith(groupId.toString());
    expect(events.findForGroupInRange).toHaveBeenCalledWith(groupId, new Date(from), new Date(to));
    expect(tasks.findWithDueDateInRange).toHaveBeenCalledWith(groupId, new Date(from), new Date(to));
    expect(result).toEqual({
      events: [{ _id: expect.anything(), title: 'Event A' }],
      tasks: [{ _id: expect.anything(), title: 'Task A' }],
    });
  });

  it('omits tasks (events-only) without 404ing when kanban is not in featureToggles', async () => {
    cls.get.mockReturnValue({ tenantId, userId, role: 'user', edition: 'kb', featureToggles: ['calendar'] });

    const result = await controller.list(groupId.toString(), from, to);

    expect(tasks.findWithDueDateInRange).not.toHaveBeenCalled();
    expect(result).toEqual({
      events: [{ _id: expect.anything(), title: 'Event A' }],
      tasks: [],
    });
  });

  it('returns 404 (never 403) for a non-member', async () => {
    membership.isMember.mockResolvedValue(false);
    await expect(controller.list(groupId.toString(), from, to)).rejects.toThrow(NotFoundException);
    expect(events.findForGroupInRange).not.toHaveBeenCalled();
    expect(tasks.findWithDueDateInRange).not.toHaveBeenCalled();
  });
});
