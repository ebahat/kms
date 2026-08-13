import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, UseFilters, UseGuards } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CreateGroupRequestSchema, UpdateGroupMembersRequestSchema } from '@kms/contracts';
import {
  AuditEventsRepository,
  EventsRepository,
  FoldersRepository,
  GroupDocument,
  GroupsRepository,
  SCOPE_CLS_KEY,
  Scope,
  TasksRepository,
  toObjectId,
} from '@kms/data';
import { PermissionCache } from '@kms/permissions';
import { AdminOnlyGuard } from '../common/admin-only.guard';
import { FolderExceptionFilter } from '../folders/folder-exception.filter';
import { PERMISSION_CACHE } from '../redis.provider';

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * Task 6 of the Phase 2 folder/group management plan. Create/membership-edit/
 * delete are tenant-admin-only (AdminOnlyGuard, same as DocumentsController's
 * recycle-bin routes) — group *names* existing isn't the sensitive part (their
 * folder grants and calendar/kanban contents stay gated by their own
 * controllers), so plain list/detail reads are open to any authenticated
 * tenant user, unlike the admin-only mutations.
 *
 * Shares FoldersController's FolderExceptionFilter purely for its ZodError→400 mapping (the
 * folder-domain error branches it also catches never fire here) — the alternative was a second,
 * near-identical filter, which the review that caught this gap rejected as needless duplication.
 */
@Controller('groups')
@UseFilters(FolderExceptionFilter)
export class GroupsController {
  constructor(
    private readonly cls: ClsService,
    private readonly groups: GroupsRepository,
    private readonly folders: FoldersRepository,
    private readonly events: EventsRepository,
    private readonly tasks: TasksRepository,
    private readonly auditEvents: AuditEventsRepository,
    @Inject(PERMISSION_CACHE) private readonly cache: PermissionCache,
  ) {}

  @Get()
  async list() {
    const scope = this.currentScope();
    const allGroups = await this.groups.findAllForTenant();
    return allGroups.map((g) => this.toSummary(g, scope));
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    if (!OBJECT_ID_RE.test(id)) throw new NotFoundException();
    const scope = this.currentScope();
    const group = await this.groups.findById(toObjectId(id));
    if (!group) throw new NotFoundException();
    return this.toSummary(group as unknown as GroupDocument, scope);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(AdminOnlyGuard)
  async create(@Body() body: unknown) {
    const { name } = CreateGroupRequestSchema.parse(body);
    const scope = this.currentScope();
    const created = await this.groups.createGroup(name);
    await this.auditEvents.record({ action: 'group.created', targetId: created._id, metadata: { name } });
    return this.toSummary(created, scope);
  }

  /**
   * Group membership feeds ADR-0005's principal set (a user's effective
   * folder access depends on which groups they belong to), so an add/remove
   * here needs the same permVersion bump + audit discipline as a folder
   * grant change (Task 5) — easy to miss because it lives in a different
   * controller. `remove` runs before `add`: if the same id appears in both
   * (a malformed/pathological request, not a designed case), the net effect
   * is "added" — an explicit re-add is treated as the caller's real intent.
   */
  @Patch(':id/members')
  @UseGuards(AdminOnlyGuard)
  async updateMembers(@Param('id') id: string, @Body() body: unknown) {
    const { add, remove } = UpdateGroupMembersRequestSchema.parse(body);
    if (add.length === 0 && remove.length === 0) throw new BadRequestException('add or remove must include at least one user id');
    if (!OBJECT_ID_RE.test(id)) throw new NotFoundException();

    const existing = await this.groups.findById(toObjectId(id));
    if (!existing) throw new NotFoundException();

    if (remove.length > 0) await this.groups.removeMembers(toObjectId(id), remove.map(toObjectId));
    if (add.length > 0) await this.groups.addMembers(toObjectId(id), add.map(toObjectId));

    const updated = await this.groups.findById(toObjectId(id));
    await this.bumpVersionAndAudit(id, 'group.members.updated', { add, remove });

    return this.toSummary(updated as unknown as GroupDocument, this.currentScope());
  }

  /**
   * Reject-when-in-use, same MVP posture as folder delete (Task 4) — no
   * cascade. A group can be referenced by a folder grant, a calendar event,
   * or a kanban task; deleting out from under any of those would either
   * silently narrow access (folder grant) or orphan a reference (events/
   * tasks store groupId directly, not a grant).
   */
  @Delete(':id')
  @HttpCode(200)
  @UseGuards(AdminOnlyGuard)
  async remove(@Param('id') id: string) {
    if (!OBJECT_ID_RE.test(id)) throw new NotFoundException();
    const group = await this.groups.findById(toObjectId(id));
    if (!group) throw new NotFoundException();

    const [hasGrant, events, tasks] = await Promise.all([
      this.hasAnyFolderGrant(group._id),
      this.events.findForGroup(group._id),
      this.tasks.findForGroup(group._id),
    ]);
    if (hasGrant || events.length > 0 || tasks.length > 0) {
      throw new ConflictException({ error: 'GROUP_IN_USE', message: 'This group still has folder access, calendar events, or kanban tasks. Remove those first.' });
    }

    await this.groups.deleteOne({ _id: group._id });
    await this.auditEvents.record({ action: 'group.deleted', targetId: group._id, metadata: {} });
    return { deleted: true };
  }

  private async hasAnyFolderGrant(groupId: ReturnType<typeof toObjectId>): Promise<boolean> {
    const allFolders = await this.folders.findAllForTenant();
    return allFolders.some((f) => f.grants.some((g) => g.principalType === 'group' && g.principalId.equals(groupId)));
  }

  /** Same best-effort-bump / required-audit discipline as FoldersController's grant mutations (Task 5). */
  private async bumpVersionAndAudit(groupId: string, action: string, metadata: Record<string, unknown>): Promise<void> {
    const scope = this.currentScope();
    try {
      await this.cache.bumpVersion(scope.tenantId.toString());
    } catch {
      // Best-effort — see FoldersController.bumpVersionAndAudit for the full reasoning (Task 5).
    }
    await this.auditEvents.record({ action, targetId: toObjectId(groupId), metadata });
  }

  private currentScope(): Scope {
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope) throw new Error('GroupsController: no scope in CLS — SessionAuthGuard should have populated it or rejected the request.');
    return scope;
  }

  /**
   * memberUserIds is membership data, not just "the group exists" data (e.g. it reveals exactly
   * who is in an "Executives" or "Legal" group) — withheld from a caller who is neither a tenant
   * admin nor a member of this specific group, same withholding pattern as
   * FoldersController.detail()'s grants array below manage tier.
   */
  private toSummary(group: GroupDocument, scope: Scope) {
    const base = { id: group._id.toString(), name: group.name };
    const isMember = group.memberUserIds.some((id) => id.equals(scope.userId));
    if (scope.role !== 'admin' && !isMember) return base;
    return { ...base, memberUserIds: group.memberUserIds.map((id) => id.toString()) };
  }
}
