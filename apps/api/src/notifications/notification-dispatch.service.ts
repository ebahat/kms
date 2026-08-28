import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  DocumentDocument,
  EventDocument,
  FoldersRepository,
  GroupsRepository,
  NotificationPreferenceField,
  SCOPE_CLS_KEY,
  Scope,
  TaskDocument,
  UserNotificationPreferencesRepository,
  UsersRepository,
  newObjectId,
} from '@kms/data';
import { foldersAccessibleToGroup } from './folder-group-access';
import { NOTIFICATION_PROVIDER, NotificationProvider } from './notifications.providers';

/** Local alias so this file never imports `mongoose` itself (ADR-0001 confines that to libs/data). */
type ObjectId = ReturnType<typeof newObjectId>;

/**
 * Real email dispatch (Task 6, replacing the Task 4/5 placeholders).
 * notifyEventCreated/notifyTaskAssigned are always-on triggers, not
 * preference-gated (design doc decision 6). notifyFileAdded/notifyFileDeleted/
 * notifyTaskAdded/notifyTaskDeleted/notifyTaskStatusChanged (Task 8) are the
 * opt-in set, gated by UserNotificationPreference's off/mine/all per field.
 */
@Injectable()
export class NotificationDispatchService {
  constructor(
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProvider,
    private readonly groups: GroupsRepository,
    private readonly users: UsersRepository,
    private readonly preferences: UserNotificationPreferencesRepository,
    private readonly folders: FoldersRepository,
    private readonly cls: ClsService,
  ) {}

  /** Emails every other member of the event's group — the creator is excluded. */
  async notifyEventCreated(event: EventDocument): Promise<void> {
    const group = await this.groups.findById(event.groupId);
    if (!group) return;
    const recipients = group.members.map((m) => m.userId).filter((id) => !id.equals(event.createdBy));
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

  /** "mine" = the uploader (document.createdBy); "all" = users with folder access via a group grant. */
  async notifyFileAdded(document: DocumentDocument): Promise<void> {
    await this.dispatchPreferenceGatedForFolder(
      'fileAdded',
      document.folderId,
      document.createdBy,
      `New file: ${document.name}`,
      `"${document.name}" was added. View in app.`,
    );
  }

  async notifyFileDeleted(document: DocumentDocument): Promise<void> {
    await this.dispatchPreferenceGatedForFolder(
      'fileDeleted',
      document.folderId,
      document.createdBy,
      `Deleted: ${document.name}`,
      `"${document.name}" was deleted. View in app.`,
    );
  }

  /** "mine" = the assignee, falling back to the creator when unassigned; "all" = every member of the task's group. */
  async notifyTaskAdded(task: TaskDocument): Promise<void> {
    await this.dispatchPreferenceGatedForGroup(
      'taskAdded',
      task.groupId,
      task.assigneeUserId ?? task.createdBy,
      `New task: ${task.title}`,
      `"${task.title}" was added. View in app.`,
    );
  }

  async notifyTaskDeleted(task: TaskDocument): Promise<void> {
    await this.dispatchPreferenceGatedForGroup(
      'taskDeleted',
      task.groupId,
      task.assigneeUserId ?? task.createdBy,
      `Deleted: ${task.title}`,
      `"${task.title}" was deleted. View in app.`,
    );
  }

  async notifyTaskStatusChanged(task: TaskDocument): Promise<void> {
    await this.dispatchPreferenceGatedForGroup(
      'taskStatusChanged',
      task.groupId,
      task.assigneeUserId ?? task.createdBy,
      `Status changed: ${task.title}`,
      `"${task.title}" moved to ${task.column}. View in app.`,
    );
  }

  private async dispatchPreferenceGatedForFolder(
    field: NotificationPreferenceField,
    folderId: ObjectId,
    mineOwnerId: ObjectId,
    subject: string,
    body: string,
  ): Promise<void> {
    const actorUserId = this.currentActorId();
    const [mine, all] = await Promise.all([
      this.resolveMineRecipient(field, actorUserId, mineOwnerId),
      this.resolveAllRecipientsForFolder(field, folderId, actorUserId),
    ]);
    await this.emailUsers(this.dedupeExcluding(actorUserId, [...mine, ...all]), subject, body);
  }

  private async dispatchPreferenceGatedForGroup(
    field: NotificationPreferenceField,
    groupId: ObjectId,
    mineOwnerId: ObjectId,
    subject: string,
    body: string,
  ): Promise<void> {
    const actorUserId = this.currentActorId();
    const [mine, all] = await Promise.all([
      this.resolveMineRecipient(field, actorUserId, mineOwnerId),
      this.resolveAllRecipientsForGroup(field, groupId, actorUserId),
    ]);
    await this.emailUsers(this.dedupeExcluding(actorUserId, [...mine, ...all]), subject, body);
  }

  /** "all" is a superset of "mine" — a user who wants every notification for a field also hears about their own items. */
  private async resolveMineRecipient(field: NotificationPreferenceField, actorUserId: ObjectId, mineOwnerId: ObjectId): Promise<ObjectId[]> {
    if (mineOwnerId.equals(actorUserId)) return [];
    const pref = await this.preferences.findOrCreateForUser(mineOwnerId);
    return pref[field] === 'mine' || pref[field] === 'all' ? [mineOwnerId] : [];
  }

  /**
   * Candidates are checked concurrently rather than one DB round-trip at a
   * time. `groupAccessCache` stores promises, not resolved values, and the
   * has/set pair around each cache miss never straddles an `await` — so
   * concurrent candidates sharing a group still single-flight into one
   * `foldersAccessibleToGroup` call rather than issuing duplicates.
   */
  private async resolveAllRecipientsForFolder(field: NotificationPreferenceField, folderId: ObjectId, actorUserId: ObjectId): Promise<ObjectId[]> {
    const candidates = (await this.preferences.findAllWithPreference(field, 'all')).map((p) => p.userId).filter((id) => !id.equals(actorUserId));
    if (candidates.length === 0) return [];

    const groupAccessCache = new Map<string, Promise<ObjectId[]>>();
    const results = await Promise.all(
      candidates.map(async (userId) => {
        const memberGroups = await this.groups.findForMember(userId);
        for (const group of memberGroups) {
          const key = group._id.toString();
          if (!groupAccessCache.has(key)) {
            groupAccessCache.set(key, foldersAccessibleToGroup(this.folders, group._id));
          }
          const accessibleFolders = await groupAccessCache.get(key)!;
          if (accessibleFolders.some((id) => id.equals(folderId))) return userId;
        }
        return null;
      }),
    );
    return results.filter((id): id is ObjectId => id !== null);
  }

  private async resolveAllRecipientsForGroup(field: NotificationPreferenceField, groupId: ObjectId, actorUserId: ObjectId): Promise<ObjectId[]> {
    const group = await this.groups.findById(groupId);
    if (!group) return [];
    const allIds = new Set((await this.preferences.findAllWithPreference(field, 'all')).map((p) => p.userId.toString()));
    return group.members.map((m) => m.userId).filter((id) => !id.equals(actorUserId) && allIds.has(id.toString()));
  }

  private dedupeExcluding(actorUserId: ObjectId, ids: ObjectId[]): ObjectId[] {
    const seen = new Map<string, ObjectId>();
    for (const id of ids) {
      if (!id.equals(actorUserId)) seen.set(id.toString(), id);
    }
    return [...seen.values()];
  }

  /** These triggers always fire from inside a request — the guard chain has already populated CLS scope. */
  private currentActorId(): ObjectId {
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope) throw new Error('NotificationDispatchService: no scope in CLS — SessionAuthGuard should have populated it or rejected the request.');
    return scope.userId;
  }

  private async emailUsers(userIds: ObjectId[], subject: string, body: string): Promise<void> {
    const recipients = await Promise.all(userIds.map((id) => this.users.findById(id)));
    await Promise.all(
      recipients
        .filter((u): u is NonNullable<typeof u> => !!u)
        .map((u) => this.provider.sendEmail({ to: u.email, subject, body })),
    );
  }
}
