import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Edition, Module } from '@kms/contracts';
import { AuditEventsRepository, SCOPE_CLS_KEY, Scope, TASK_COLUMNS, TaskColumn, TasksRepository, toObjectId } from '@kms/data';
import { GroupsMembershipService } from './groups-membership.service';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';

@Controller('groups/:groupId/tasks')
@Edition('kb')
@Module('kanban')
export class TasksController {
  constructor(
    private readonly cls: ClsService,
    private readonly tasks: TasksRepository,
    private readonly membership: GroupsMembershipService,
    private readonly auditEvents: AuditEventsRepository,
    private readonly notifications: NotificationDispatchService,
  ) {}

  @Get()
  async list(@Param('groupId') groupId: string) {
    if (!(await this.membership.isMember(groupId))) throw new NotFoundException();
    return this.tasks.findForGroup(toObjectId(groupId));
  }

  @Post()
  @HttpCode(201)
  async create(
    @Param('groupId') groupId: string,
    @Body() body: { title: string; description?: string; assigneeUserId?: string; dueDate?: string },
  ) {
    if (!(await this.membership.isMember(groupId))) throw new NotFoundException();

    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY)!;
    const task = await this.tasks.create({
      groupId: toObjectId(groupId),
      title: body.title,
      description: body.description,
      column: 'todo',
      assigneeUserId: body.assigneeUserId ? toObjectId(body.assigneeUserId) : undefined,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      createdBy: scope.userId,
    });

    await this.auditEvents.record({ action: 'kanban.task.created', targetId: task._id, metadata: { groupId } });
    if (task.assigneeUserId) await this.notifications.notifyTaskAssigned(task);
    await this.notifications.notifyTaskAdded(task);

    return task;
  }

  @Patch(':taskId')
  async update(
    @Param('groupId') groupId: string,
    @Param('taskId') taskId: string,
    @Body() body: { column?: TaskColumn; assigneeUserId?: string },
  ) {
    if (!(await this.membership.isMember(groupId))) throw new NotFoundException();

    if (body.column !== undefined && !TASK_COLUMNS.includes(body.column)) {
      throw new BadRequestException(`invalid column: ${body.column}`);
    }

    const id = toObjectId(taskId);
    const existing = await this.tasks.findById(id);
    if (!existing || !existing.groupId.equals(toObjectId(groupId))) throw new NotFoundException();

    const update: Record<string, unknown> = {};
    if (body.column && body.column !== existing.column) update.column = body.column;
    if (body.assigneeUserId && body.assigneeUserId !== existing.assigneeUserId?.toString()) {
      update.assigneeUserId = toObjectId(body.assigneeUserId);
    }

    if (Object.keys(update).length > 0) await this.tasks.updateOne({ _id: id }, { $set: update });

    if (update.column) {
      await this.auditEvents.record({
        action: 'kanban.task.statusChanged',
        targetId: id,
        metadata: { groupId, from: existing.column, to: update.column },
      });
    }

    const updated = update.column || update.assigneeUserId ? await this.tasks.findById(id) : existing;
    if (update.column) await this.notifications.notifyTaskStatusChanged(updated!);
    if (update.assigneeUserId) await this.notifications.notifyTaskAssigned(updated!);

    return updated;
  }

  @Delete(':taskId')
  @HttpCode(200)
  async remove(@Param('groupId') groupId: string, @Param('taskId') taskId: string) {
    if (!(await this.membership.isMember(groupId))) throw new NotFoundException();

    const id = toObjectId(taskId);
    const existing = await this.tasks.findById(id);
    if (!existing || !existing.groupId.equals(toObjectId(groupId))) throw new NotFoundException();

    await this.tasks.deleteOne({ _id: id });
    await this.auditEvents.record({ action: 'kanban.task.deleted', targetId: id, metadata: { groupId } });
    await this.notifications.notifyTaskDeleted(existing);

    return { deleted: true };
  }
}
