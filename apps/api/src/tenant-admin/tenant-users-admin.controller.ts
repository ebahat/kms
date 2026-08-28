import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, UseFilters, UseGuards } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { parse } from 'csv-parse/sync';
import {
  Edition,
  CreateUserRequestSchema,
  CsvImportRowSchema,
  GroupMemberRole,
  ImportUsersRequestSchema,
  CreateUserResult,
  CsvImportRowResult,
  UpdateUserRequestSchema,
  UserGroupAssignment,
  UserSummary,
} from '@kms/contracts';
import { createInviteToken, generateTempPassword, hashPassword, SessionService } from '@kms/auth';
import { AuditEventsRepository, GroupsRepository, SCOPE_CLS_KEY, Scope, toObjectId, UserDocument, UsersRepository } from '@kms/data';
import { PermissionCache } from '@kms/permissions';
import { AdminOnlyGuard } from '../common/admin-only.guard';
import { FolderExceptionFilter } from '../folders/folder-exception.filter';
import { SESSION_SERVICE } from '../auth/session-auth.guard';
import { PASSWORD_PEPPER } from '../auth/auth.providers';
import { NOTIFICATION_PROVIDER, NotificationProvider } from '../notifications/notifications.providers';
import { PERMISSION_CACHE } from '../redis.provider';

const VALID_GROUP_ROLES = new Set<GroupMemberRole>(['viewer', 'editor', 'manager']);
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * A CSV `groups` cell looks like `"Sales:editor;Legal:viewer"` — a CSV author has no group ids, so
 * rows reference groups by name (user-management plan, 2026-08-24). Returns `null` for a
 * malformed cell (bad role token, missing name/role) so the caller can report a row error; an
 * empty/absent cell is not an error and returns `[]`.
 */
export function parseCsvGroupsCell(cell: string | undefined): { name: string; role: GroupMemberRole }[] | null {
  if (!cell || !cell.trim()) return [];
  const result: { name: string; role: GroupMemberRole }[] = [];
  for (const pair of cell.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [name, role] = pair.split(':').map((s) => s.trim());
    if (!name || !role || !VALID_GROUP_ROLES.has(role as GroupMemberRole)) return null;
    result.push({ name, role: role as GroupMemberRole });
  }
  return result;
}

/**
 * Tenant-admin user management (PRD §6): create/update/deactivate/reactivate/resend-invite,
 * CSV bulk import. Every call is implicitly tenant-scoped by UsersRepository/GroupsRepository
 * (ADR-0001) — an admin can never touch another tenant's users or groups, and an id belonging to
 * another tenant 404s rather than 403s (sec §3.2 convention).
 *
 * User-management plan (2026-08-24): create/CSV-import now send an invite-activation email instead
 * of returning a one-time temp password (see AuthController's activate/check + activate/confirm),
 * and group membership (with a per-group viewer/editor/manager role, ADR-0005's resolver) is set
 * here alongside identity fields — see `diffGroupMemberships`.
 *
 * @UseFilters(FolderExceptionFilter) here purely for its ZodError->400 mapping — same reuse
 * GroupsController already makes of it, for the same reason (a raw ZodError from
 * `Schema.parse(body)` would otherwise surface as an unhandled 500). Its folder-domain error
 * branches never fire from these routes (security review finding, 2026-08-24 — this controller had
 * neither the filter nor an ObjectId shape guard on `:id`, unlike its sibling controllers).
 */
@Controller('tenant-admin/users')
@Edition('both')
@UseGuards(AdminOnlyGuard)
@UseFilters(FolderExceptionFilter)
export class TenantUsersAdminController {
  constructor(
    private readonly users: UsersRepository,
    private readonly groups: GroupsRepository,
    private readonly auditEvents: AuditEventsRepository,
    private readonly cls: ClsService,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(PASSWORD_PEPPER) private readonly pepper: string,
    @Inject(NOTIFICATION_PROVIDER) private readonly notifications: NotificationProvider,
    @Inject(PERMISSION_CACHE) private readonly cache: PermissionCache,
  ) {}

  @Get()
  async list(): Promise<UserSummary[]> {
    const docs = await this.users.find({});
    return docs.map(toSummary);
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown): Promise<CreateUserResult> {
    const { email, firstName, lastName, role, groups } = CreateUserRequestSchema.parse(body);
    await this.assertGroupsExist(groups);

    const passwordHash = await this.randomUnguessablePasswordHash();

    let created: UserDocument;
    try {
      created = await this.users.create({
        email: email.toLowerCase().trim(),
        firstName,
        lastName,
        role,
        passwordHash,
        status: 'pending',
        mfaEnabled: false,
        totpBackupCodeHashes: [],
      });
    } catch {
      // email carries a global unique index (login resolves tenant FROM email — see user.schema.ts)
      throw new ConflictException({ error: 'EMAIL_ALREADY_EXISTS' });
    }

    await this.applyGroupMemberships(created._id, groups);
    await this.issueInvite(created._id, created.email);

    return { userId: created._id.toString(), email: created.email, status: 'pending' };
  }

  @Patch(':id')
  @HttpCode(200)
  async update(@Param('id') id: string, @Body() body: unknown): Promise<UserSummary> {
    const patch = UpdateUserRequestSchema.parse(body);
    if (Object.keys(patch).length === 0) throw new BadRequestException('at least one field must be provided');
    if (!OBJECT_ID_RE.test(id)) throw new NotFoundException();

    const objectId = toObjectId(id);
    const user = await this.users.findById(objectId);
    if (!user) throw new NotFoundException();

    if (patch.groups) await this.assertGroupsExist(patch.groups);

    const $set: Record<string, unknown> = {};
    if (patch.firstName !== undefined) $set.firstName = patch.firstName;
    if (patch.lastName !== undefined) $set.lastName = patch.lastName;

    const normalizedEmail = patch.email?.toLowerCase().trim();
    const emailChanged = normalizedEmail !== undefined && normalizedEmail !== user.email;
    if (emailChanged) $set.email = normalizedEmail;

    const roleChanged = patch.role !== undefined && patch.role !== user.role;
    if (patch.role !== undefined) $set.role = patch.role;

    if (Object.keys($set).length > 0) {
      try {
        await this.users.updateOne({ _id: objectId }, { $set });
      } catch {
        throw new ConflictException({ error: 'EMAIL_ALREADY_EXISTS' });
      }
    }

    // A demoted/promoted admin must not keep the old role's privileges via an already-populated
    // session — CLS scope is seeded from the session record, not re-read from the DB per request.
    if (roleChanged) await this.sessions.revokeAll('tenant', objectId.toString());

    // The old invite link points at the old address and is otherwise still "valid" — re-issuing
    // both invalidates it (a fresh token overwrites the stored hash) and gets the new address a
    // working link. Only meaningful for a still-pending user; an active user's email change needs
    // no re-verification here (admin-initiated, not self-service — see the plan's deferred items).
    if (emailChanged && user.status === 'pending') {
      const refreshed = await this.users.findById(objectId);
      await this.issueInvite(objectId, refreshed!.email);
    }

    if (patch.groups) await this.diffGroupMemberships(objectId, patch.groups);

    const updated = await this.users.findById(objectId);
    return toSummary(updated!);
  }

  @Post(':id/resend-invite')
  @HttpCode(200)
  async resendInvite(@Param('id') id: string): Promise<{ ok: true }> {
    if (!OBJECT_ID_RE.test(id)) throw new NotFoundException();
    const objectId = toObjectId(id);
    const user = await this.users.findById(objectId);
    if (!user) throw new NotFoundException();
    if (user.status !== 'pending') throw new ConflictException({ error: 'NOT_PENDING' });

    await this.issueInvite(objectId, user.email);
    return { ok: true };
  }

  @Patch(':id/deactivate')
  @HttpCode(200)
  async deactivate(@Param('id') id: string): Promise<{ ok: true }> {
    if (!OBJECT_ID_RE.test(id)) throw new NotFoundException();
    const objectId = toObjectId(id);
    const user = await this.users.findById(objectId);
    if (!user) throw new NotFoundException();

    // $unset both token pairs, not just the invite one — a reset token issued shortly before
    // deactivation (e.g. an offboarding that overlaps a live 30-minute reset window) must not
    // remain usable if the account is later reactivated (security review finding, 2026-08-24).
    //
    // activatedAt backfill: this is the one moment we can still tell "this account was genuinely
    // active/locked" from "this account was still pending" — status is about to be overwritten to
    // 'inactive' either way. A user who reaches here with status !== 'pending' and no activatedAt
    // yet must have gone through the pre-2026-08-24 create flow (temp password, no activation
    // step) — stamping it now, lazily, is what lets reactivate() later tell them apart from someone
    // deactivated while still pending, without a separate migration (security review finding,
    // 2026-08-24 — the alternative left every pre-existing account, including every seeded admin,
    // wrongly forced back to 'pending' on reactivate).
    const wasEverActivated = user.status !== 'pending';
    await this.users.updateOne(
      { _id: objectId },
      {
        $set: { status: 'inactive', ...(wasEverActivated && !user.activatedAt ? { activatedAt: new Date() } : {}) },
        $unset: { inviteTokenHash: '', inviteExpiresAt: '', passwordResetTokenHash: '', passwordResetExpiresAt: '' },
      },
    );
    await this.sessions.revokeAll('tenant', user._id.toString()); // deactivation immediately revokes all sessions (PRD §6)
    return { ok: true };
  }

  /**
   * `activatedAt` (set the first time a user really completes activation, or backfilled by
   * deactivate() above for a pre-existing account) tells apart two different "inactive" histories:
   * someone who was deactivated after actually using the system goes back to 'active' as before;
   * someone who was deactivated while their invite was still outstanding goes back to 'pending'
   * with a fresh invite email, since their old link is almost certainly expired or was never used.
   */
  @Patch(':id/reactivate')
  @HttpCode(200)
  async reactivate(@Param('id') id: string): Promise<{ ok: true }> {
    if (!OBJECT_ID_RE.test(id)) throw new NotFoundException();
    const objectId = toObjectId(id);
    const user = await this.users.findById(objectId);
    if (!user) throw new NotFoundException();

    if (user.activatedAt) {
      await this.users.updateOne({ _id: objectId }, { $set: { status: 'active' } });
    } else {
      await this.users.updateOne({ _id: objectId }, { $set: { status: 'pending' } });
      await this.issueInvite(objectId, user.email);
    }
    return { ok: true };
  }

  /**
   * Accepts raw CSV text rather than a multipart file upload — there is no
   * file-upload plumbing (multer) in this API yet, and the web UI (Phase 1.7)
   * is the natural place to read the File and forward its text content.
   */
  @Post('import')
  @HttpCode(200)
  async importCsv(@Body() body: unknown): Promise<{ results: CsvImportRowResult[] }> {
    const { csvContent } = ImportUsersRequestSchema.parse(body);
    const records: Record<string, string>[] = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });

    const results: CsvImportRowResult[] = [];
    for (let i = 0; i < records.length; i++) {
      const rowNumber = i + 1;
      const raw = records[i];
      const parsed = CsvImportRowSchema.safeParse({
        email: raw.email,
        firstName: raw.firstName || undefined,
        lastName: raw.lastName || undefined,
        role: raw.role || undefined,
        groups: raw.groups || undefined,
      });

      if (!parsed.success) {
        results.push({ row: rowNumber, email: raw.email, status: 'error', error: parsed.error.issues[0]?.message ?? 'invalid row' });
        continue;
      }

      const parsedGroups = parseCsvGroupsCell(parsed.data.groups);
      if (parsedGroups === null) {
        results.push({ row: rowNumber, email: parsed.data.email, status: 'error', error: 'invalid groups cell' });
        continue;
      }

      const resolvedGroups: UserGroupAssignment[] = [];
      let unknownGroup: string | null = null;
      for (const { name, role } of parsedGroups) {
        const group = await this.groups.findOneByName(name);
        if (!group) {
          unknownGroup = name;
          break;
        }
        resolvedGroups.push({ groupId: group._id.toString(), role });
      }
      if (unknownGroup) {
        results.push({ row: rowNumber, email: parsed.data.email, status: 'error', error: `unknown group: ${unknownGroup}` });
        continue;
      }

      try {
        const passwordHash = await this.randomUnguessablePasswordHash();
        const created = await this.users.create({
          email: parsed.data.email,
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          role: parsed.data.role,
          passwordHash,
          status: 'pending',
          mfaEnabled: false,
          totpBackupCodeHashes: [],
        });
        await this.applyGroupMemberships(created._id, resolvedGroups);
        await this.issueInvite(created._id, created.email);
        results.push({ row: rowNumber, email: parsed.data.email, status: 'created' });
      } catch {
        results.push({ row: rowNumber, email: parsed.data.email, status: 'error', error: 'email already exists' });
      }
    }

    return { results };
  }

  /** 404s (as `GROUP_NOT_FOUND`) at the first assignment naming a group outside this tenant, rather than silently dropping it. */
  private async assertGroupsExist(assignments: UserGroupAssignment[]): Promise<void> {
    for (const { groupId } of assignments) {
      const group = await this.groups.findById(toObjectId(groupId));
      if (!group) throw new BadRequestException({ error: 'GROUP_NOT_FOUND', groupId });
    }
  }

  /** New user, no prior memberships to reconcile — just set each one and bump once. */
  private async applyGroupMemberships(userId: UserDocument['_id'], assignments: UserGroupAssignment[]): Promise<void> {
    if (assignments.length === 0) return;
    for (const { groupId, role } of assignments) await this.groups.setMember(toObjectId(groupId), userId, role);
    await this.bumpPermVersionAndAudit('user.groups.updated', userId, { added: assignments });
  }

  /**
   * Reconciles this user's group memberships to exactly the desired set: unions the tenant's
   * groups the user currently belongs to (GroupsRepository.findForMember) against the requested
   * list, `setMember`s anything new or role-changed, `removeMembers`s anything dropped. Bumps
   * permVersion once for the whole operation — membership feeds ADR-0005's principal set the same
   * way a folder grant change does (GroupsController's existing precedent).
   */
  private async diffGroupMemberships(userId: UserDocument['_id'], desired: UserGroupAssignment[]): Promise<void> {
    const currentGroups = await this.groups.findForMember(userId);
    const currentByGroupId = new Map(
      currentGroups.map((g) => [g._id.toString(), g.members.find((m) => m.userId.equals(userId))?.role]),
    );
    const desiredByGroupId = new Map(desired.map((d) => [d.groupId, d.role]));

    const changed: UserGroupAssignment[] = [];
    for (const { groupId, role } of desired) {
      if (currentByGroupId.get(groupId) !== role) {
        await this.groups.setMember(toObjectId(groupId), userId, role);
        changed.push({ groupId, role });
      }
    }
    const removedGroupIds = [...currentByGroupId.keys()].filter((groupId) => !desiredByGroupId.has(groupId));
    for (const groupId of removedGroupIds) await this.groups.removeMembers(toObjectId(groupId), [userId]);

    if (changed.length > 0 || removedGroupIds.length > 0) {
      await this.bumpPermVersionAndAudit('user.groups.updated', userId, { changed, removed: removedGroupIds });
    }
  }

  /** Same best-effort-bump / required-audit discipline as GroupsController/FoldersController's grant mutations. */
  private async bumpPermVersionAndAudit(action: string, targetId: UserDocument['_id'], metadata: Record<string, unknown>): Promise<void> {
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (scope) {
      try {
        await this.cache.bumpVersion(scope.tenantId.toString());
      } catch {
        // Best-effort — see FoldersController.bumpVersionAndAudit for the full reasoning.
      }
    }
    await this.auditEvents.record({ action, targetId, metadata });
  }

  /** Never returned, logged, or emailed — the account is unusable until activation sets a real password. */
  private async randomUnguessablePasswordHash(): Promise<string> {
    return hashPassword(generateTempPassword(), this.pepper);
  }

  private async issueInvite(userId: UserDocument['_id'], email: string): Promise<void> {
    const { rawToken, tokenHash, expiresAt } = createInviteToken();
    await this.users.updateOne({ _id: userId }, { $set: { inviteTokenHash: tokenHash, inviteExpiresAt: expiresAt } });

    const appUrl = process.env.APP_PUBLIC_URL ?? 'http://localhost:3010';
    const activateLink = `${appUrl}/activate?email=${encodeURIComponent(email)}&token=${rawToken}`;
    await this.notifications.sendEmail({
      to: email,
      subject: 'הזמנה למערכת',
      body: `הוזמנת למערכת. ליצירת סיסמה והתחברות, לחץ/י על הקישור הבא (בתוקף ל-24 שעות): ${activateLink}`,
    });
  }
}

function toSummary(doc: UserDocument): UserSummary {
  return {
    id: doc._id.toString(),
    email: doc.email,
    firstName: doc.firstName,
    lastName: doc.lastName,
    role: doc.role,
    status: doc.status,
    mfaEnabled: doc.mfaEnabled,
    lastLoginAt: doc.lastLoginAt,
  };
}
