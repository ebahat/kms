import { Inject, Injectable } from '@nestjs/common';
import { EventDocument, GroupsRepository, TaskDocument, UsersRepository } from '@kms/data';
import { NOTIFICATION_PROVIDER, NotificationProvider } from './notifications.providers';

/**
 * Real email dispatch (Task 6, replacing the Task 4/5 placeholders).
 * notifyEventCreated/notifyTaskAssigned are always-on triggers, not
 * preference-gated (design doc decision 6) — preference gating lands in
 * Task 8 for a different, later set of triggers.
 */
@Injectable()
export class NotificationDispatchService {
  constructor(
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProvider,
    private readonly groups: GroupsRepository,
    private readonly users: UsersRepository,
  ) {}

  /** Emails every other member of the event's group — the creator is excluded. */
  async notifyEventCreated(event: EventDocument): Promise<void> {
    const group = await this.groups.findById(event.groupId);
    if (!group) return;
    const recipients = group.memberUserIds.filter((id) => !id.equals(event.createdBy));
    await this.emailUsers(
      recipients,
      `Invited: ${event.title}`,
      `You've been invited to "${event.title}" on ${event.startAt.toISOString()}. View in app.`,
    );
  }

  /** Emails only the assignee. A no-op (not an error) when the task is unassigned. */
  async notifyTaskAssigned(task: TaskDocument): Promise<void> {
    if (!task.assigneeUserId) return;
    await this.emailUsers(
      [task.assigneeUserId],
      `Assigned: ${task.title}`,
      `You've been assigned to "${task.title}"${task.dueDate ? `, due ${task.dueDate.toISOString()}` : ''}. View in app.`,
    );
  }

  private async emailUsers(userIds: import('mongoose').Types.ObjectId[], subject: string, body: string): Promise<void> {
    const recipients = await Promise.all(userIds.map((id) => this.users.findById(id)));
    await Promise.all(
      recipients
        .filter((u): u is NonNullable<typeof u> => !!u)
        .map((u) => this.provider.sendEmail({ to: u.email, subject, body })),
    );
  }
}
