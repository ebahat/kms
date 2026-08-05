import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Module } from '@kms/contracts';
import { AuditEventsRepository, EventsRepository, SCOPE_CLS_KEY, Scope, toObjectId } from '@kms/data';
import { GroupsMembershipService } from './groups-membership.service';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';

@Controller('groups/:groupId/events')
@Module('calendar')
export class EventsController {
  constructor(
    private readonly cls: ClsService,
    private readonly events: EventsRepository,
    private readonly membership: GroupsMembershipService,
    private readonly auditEvents: AuditEventsRepository,
    private readonly notifications: NotificationDispatchService,
  ) {}

  @Get()
  async list(@Param('groupId') groupId: string) {
    if (!(await this.membership.isMember(groupId))) throw new NotFoundException();
    return this.events.findForGroup(toObjectId(groupId));
  }

  @Post()
  @HttpCode(201)
  async create(
    @Param('groupId') groupId: string,
    @Body() body: { title: string; description?: string; startAt: string; endAt: string; location?: string },
  ) {
    if (!(await this.membership.isMember(groupId))) throw new NotFoundException();

    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY)!;
    const event = await this.events.create({
      groupId: toObjectId(groupId),
      title: body.title,
      description: body.description,
      startAt: new Date(body.startAt),
      endAt: new Date(body.endAt),
      location: body.location,
      createdBy: scope.userId,
    });

    await this.auditEvents.record({ action: 'calendar.event.created', targetId: event._id, metadata: { groupId } });
    await this.notifications.notifyEventCreated(event); // always-on invite email, decision 6 — not preference-gated

    return event;
  }

  @Patch(':eventId')
  @HttpCode(200)
  async update(
    @Param('groupId') groupId: string,
    @Param('eventId') eventId: string,
    @Body() body: { title?: string; description?: string; startAt?: string; endAt?: string; location?: string },
  ) {
    if (!(await this.membership.isMember(groupId))) throw new NotFoundException();

    const id = toObjectId(eventId);
    const existing = await this.events.findById(id);
    if (!existing || !existing.groupId.equals(toObjectId(groupId))) throw new NotFoundException();

    await this.events.updateOne(
      { _id: id },
      {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.startAt !== undefined && { startAt: new Date(body.startAt) }),
        ...(body.endAt !== undefined && { endAt: new Date(body.endAt) }),
        ...(body.location !== undefined && { location: body.location }),
      },
    );

    await this.auditEvents.record({ action: 'calendar.event.updated', targetId: id, metadata: { groupId } });

    return this.events.findById(id);
  }

  @Delete(':eventId')
  @HttpCode(200)
  async remove(@Param('groupId') groupId: string, @Param('eventId') eventId: string) {
    if (!(await this.membership.isMember(groupId))) throw new NotFoundException();

    const id = toObjectId(eventId);
    const existing = await this.events.findById(id);
    if (!existing || !existing.groupId.equals(toObjectId(groupId))) throw new NotFoundException();

    await this.events.deleteOne({ _id: id });
    await this.auditEvents.record({ action: 'calendar.event.deleted', targetId: id, metadata: { groupId } });

    return { deleted: true };
  }
}
