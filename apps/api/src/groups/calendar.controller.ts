import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Module } from '@kms/contracts';
import { EventsRepository, SCOPE_CLS_KEY, Scope, TasksRepository, toObjectId } from '@kms/data';
import { GroupsMembershipService } from './groups-membership.service';

@Controller('groups/:groupId/calendar')
@Module('calendar')
export class CalendarController {
  constructor(
    private readonly cls: ClsService,
    private readonly events: EventsRepository,
    private readonly tasks: TasksRepository,
    private readonly membership: GroupsMembershipService,
  ) {}

  @Get()
  async list(@Param('groupId') groupId: string, @Query('from') from: string, @Query('to') to: string) {
    if (!(await this.membership.isMember(groupId))) throw new NotFoundException();

    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY)!;
    const range = { from: new Date(from), to: new Date(to) };
    const events = await this.events.findForGroupInRange(toObjectId(groupId), range.from, range.to);

    // Degrades gracefully, doesn't 404, when kanban is off (design doc decision) — not a ModuleGuard check, a direct featureToggles read.
    const tasks = scope.featureToggles.includes('kanban')
      ? await this.tasks.findWithDueDateInRange(toObjectId(groupId), range.from, range.to)
      : [];

    return { events, tasks };
  }
}
