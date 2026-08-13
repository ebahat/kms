import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  CreateFolderRequestSchema,
  FolderGrantRequestSchema,
  MoveFolderRequestSchema,
  RenameFolderRequestSchema,
  RevokeFolderGrantRequestSchema,
  SetFolderPublicRequestSchema,
} from '@kms/contracts';
import {
  AuditEventsRepository,
  DocumentsRepository,
  FolderDocument,
  FolderNotEmptyError,
  FoldersRepository,
  GroupsRepository,
  SCOPE_CLS_KEY,
  Scope,
  toObjectId,
} from '@kms/data';
import {
  FolderPermissionResolution,
  FolderWideningInfo,
  PermissionCache,
  computeFolderWideningCached,
  resolveFolderPermissions,
  resolveFolderPermissionsCached,
  toFolderInputs,
  toPrincipalSet,
} from '@kms/permissions';
import { PERMISSION_CACHE } from '../redis.provider';
import { FolderExceptionFilter } from './folder-exception.filter';

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

interface FolderSummary {
  id: string;
  name: string;
  parentId: string | null;
  hasExplicitGrants: boolean;
  isPublic: boolean;
  tier: 'read' | 'edit' | 'manage';
  broaderThanParent: boolean;
  addedGroups: string[];
  becamePublic: boolean;
  /** Root-to-immediate-parent ancestor chain (Phase 2 UI plan Task 3 — the folder-tree screen's breadcrumb needs names, not just `Folder.path`'s raw ObjectIds). */
  path: { id: string; name: string }[];
}

/**
 * Task 3 of the Phase 2 folder/group management plan: the first real API
 * surface over the ADR-0005 permission-resolution library — everything here
 * (resolveFolderPermissionsCached, computeFolderWideningCached) already
 * existed and was already correct; this controller is wiring, not new logic.
 */
@Controller('folders')
@UseFilters(FolderExceptionFilter)
export class FoldersController {
  constructor(
    private readonly cls: ClsService,
    private readonly folders: FoldersRepository,
    private readonly groups: GroupsRepository,
    private readonly documents: DocumentsRepository,
    private readonly auditEvents: AuditEventsRepository,
    @Inject(PERMISSION_CACHE) private readonly cache: PermissionCache,
  ) {}

  @Get()
  async list(@Query('parentId') parentIdParam?: string): Promise<FolderSummary[]> {
    const parentKey = this.parseParentIdParam(parentIdParam);
    const scope = this.currentScope();
    const allFolders = await this.folders.findAllForTenant();
    const [resolution, widening] = await Promise.all([
      this.resolveForCaller(scope, allFolders),
      this.wideningForTenant(scope, allFolders),
    ]);

    const readable = new Set(resolution.permittedRead);
    const children = allFolders.filter((f) => (f.parentId ? f.parentId.toString() : null) === parentKey && readable.has(f._id.toString()));

    const groupNames = await this.groupNameLookup();
    const folderNames = this.folderNameLookup(allFolders);
    return children.map((f) => this.toSummary(f, resolution, widening.get(f._id.toString()), groupNames, folderNames));
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    if (!OBJECT_ID_RE.test(id)) throw new NotFoundException();
    id = id.toLowerCase(); // canonical form — see requireTier's own comment for why

    const scope = this.currentScope();
    const allFolders = await this.folders.findAllForTenant();
    const folder = allFolders.find((f) => f._id.toString() === id);
    if (!folder) throw new NotFoundException();

    const [resolution, widening] = await Promise.all([
      this.resolveForCaller(scope, allFolders),
      this.wideningForTenant(scope, allFolders),
    ]);
    if (!resolution.permittedRead.includes(id)) throw new NotFoundException();

    const groupNames = await this.groupNameLookup();
    const folderNames = this.folderNameLookup(allFolders);
    const summary = this.toSummary(folder, resolution, widening.get(id), groupNames, folderNames);

    // The raw grants array is C3 tenant-admin data (ADR-0005: "individually-granted users remain
    // visible only in the tenant-admin C3 screen") — withheld below `manage` tier.
    if (!resolution.permittedManage.includes(id)) return summary;
    return {
      ...summary,
      grants: folder.grants.map((g) => ({ principalType: g.principalType, principalId: g.principalId.toString(), access: g.access })),
    };
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const parsed = CreateFolderRequestSchema.parse(body);
    const { name } = parsed;
    // Normalized to canonical lowercase hex: Mongoose ObjectId#toString() always lowercases, but
    // the request-schema regex accepts uppercase hex too — an uppercase-but-valid id would silently
    // fail every in-memory `permittedEdit.includes(parentId)` string comparison below otherwise.
    const parentId = parsed.parentId ? parsed.parentId.toLowerCase() : null;
    const scope = this.currentScope();

    if (parentId === null) {
      // No parent to hold an `edit` grant — creating a root folder is a tenant-admin action, not a
      // hidden-resource case, so this is a real 403 rather than the usual 404-on-denial convention.
      if (scope.role !== 'admin') throw new ForbiddenException();
      const created = await this.folders.createFolder({ name, parentId: null });
      await this.bumpVersionAndAudit(created._id.toString(), 'folder.created', { parentId: null, name });
      return this.toCreatedSummary(created);
    }

    const allFolders = await this.folders.findAllForTenant();
    const resolution = await this.resolveForCaller(scope, allFolders);
    // Not in permittedEdit covers both "doesn't exist" and "caller can't add content here" —
    // FoldersRepository.createFolder's own FolderParentNotFoundError is the defense-in-depth
    // backstop behind this, not the primary check (Task 1).
    if (!resolution.permittedEdit.includes(parentId)) throw new NotFoundException();

    const created = await this.folders.createFolder({ name, parentId: toObjectId(parentId) });
    // A new folder immediately inherits its parent's effective grants, so anyone whose permission
    // resolution is still cached from before this create (including the caller themselves) would
    // have it silently missing from list()/detail() until the version bumps — this is exactly the
    // "folder-move" class of change bumpVersion's own doc comment calls out, just at creation time.
    await this.bumpVersionAndAudit(created._id.toString(), 'folder.created', { parentId, name });
    return this.toCreatedSummary(created);
  }

  @Patch(':id')
  async rename(@Param('id') id: string, @Body() body: unknown) {
    const { name } = RenameFolderRequestSchema.parse(body);
    await this.requireTier(id, 'manage');
    const updated = await this.folders.renameFolder(toObjectId(id), name);
    if (!updated) throw new NotFoundException();
    // Renaming changes neither the folder's tree position nor its grants, so no permVersion bump
    // is needed (folder names are never part of the cached resolution) — audit only.
    await this.auditEvents.record({ action: 'folder.renamed', targetId: toObjectId(id), metadata: { name } });
    return { id, name: updated.name };
  }

  @Patch(':id/move')
  async move(@Param('id') id: string, @Body() body: unknown) {
    const parsed = MoveFolderRequestSchema.parse(body);
    const parentId = parsed.parentId ? parsed.parentId.toLowerCase() : null;
    // Reuses requireTier's own resolution for the destination-edit check below instead of a second
    // findAllForTenant()+resolveForCaller() round trip — same scope, same tenant snapshot.
    const { folder, resolution } = await this.requireTier(id, 'manage');
    const scope = this.currentScope();

    if (parentId === null) {
      // Moving to root is structurally the same act as creating at root — no parent to hold an
      // `edit` grant, so it's the same tenant-admin-only rule as create(), not a hidden-resource case.
      if (scope.role !== 'admin') throw new ForbiddenException();
    } else {
      // The destination must be somewhere the caller can add content — moving into a folder they
      // can't edit would let them park content somewhere they couldn't have created it directly.
      if (!resolution.permittedEdit.includes(parentId)) throw new NotFoundException();
    }

    const moved = await this.folders.moveFolder(folder._id, parentId ? toObjectId(parentId) : null);
    // Moving a folder changes what it inherits (and, for its whole subtree, their effective
    // grants too) — this is the canonical "folder-move" trigger bumpVersion's own doc comment
    // names explicitly.
    await this.bumpVersionAndAudit(id, 'folder.moved', { parentId });
    return { id, parentId: moved.parentId ? moved.parentId.toString() : null };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id') id: string) {
    const { folder } = await this.requireTier(id, 'manage');

    // Deliberate MVP scope cut (Phase 2 plan Task 4): no folder-level recycle bin or cascade
    // delete — ADR-0006's deletion machinery is document-scoped, there is no folder-level
    // equivalent designed. Reject rather than silently orphan or cascade.
    const [children, containedDocuments] = await Promise.all([
      this.folders.findChildren(folder._id),
      this.documents.findByFolder(folder._id),
    ]);
    if (children.length > 0 || containedDocuments.length > 0) throw new FolderNotEmptyError();

    await this.folders.deleteOne({ _id: folder._id });
    // A deleted folder can only be reached via a fresh findAllForTenant() (never cached), so no
    // permVersion bump is needed for correctness — audit only, matching every other manage-tier
    // mutation in this controller.
    await this.auditEvents.record({ action: 'folder.deleted', targetId: folder._id, metadata: {} });
    return { deleted: true };
  }

  @Post(':id/grants')
  async addGrant(@Param('id') id: string, @Body() body: unknown) {
    const grant = FolderGrantRequestSchema.parse(body);
    await this.requireTier(id, 'manage');

    const updated = await this.folders.upsertGrant(toObjectId(id), { ...grant, principalId: toObjectId(grant.principalId) });
    if (!updated) throw new NotFoundException();
    await this.bumpVersionAndAudit(id, 'folder.grant.added', grant);

    return this.grantsResponse(updated);
  }

  @Delete(':id/grants')
  @HttpCode(200)
  async revokeGrant(@Param('id') id: string, @Body() body: unknown) {
    const { principalType, principalId } = RevokeFolderGrantRequestSchema.parse(body);
    await this.requireTier(id, 'manage');

    const updated = await this.folders.revokeGrant(toObjectId(id), principalType, toObjectId(principalId));
    if (!updated) throw new NotFoundException();
    await this.bumpVersionAndAudit(id, 'folder.grant.revoked', { principalType, principalId });

    return this.grantsResponse(updated);
  }

  @Post(':id/grants/inherit')
  @HttpCode(200)
  async resetToInherited(@Param('id') id: string) {
    await this.requireTier(id, 'manage');

    const updated = await this.folders.resetToInherited(toObjectId(id));
    if (!updated) throw new NotFoundException();
    // Resuming inheritance is widening-capable in its own right (the parent's audience could be
    // broader than this folder's override was) — bump + audit like any other grant mutation.
    await this.bumpVersionAndAudit(id, 'folder.grants.resetToInherited', {});

    return this.grantsResponse(updated);
  }

  @Patch(':id/public')
  async setPublic(@Param('id') id: string, @Body() body: unknown) {
    const { isPublic } = SetFolderPublicRequestSchema.parse(body);
    await this.requireTier(id, 'manage');

    const updated = await this.folders.setPublic(toObjectId(id), isPublic);
    if (!updated) throw new NotFoundException();
    await this.bumpVersionAndAudit(id, 'folder.public.changed', { isPublic });

    return this.grantsResponse(updated);
  }

  /**
   * ADR-0005's C3 "why can Dana see this?" preview — manage-tier only.
   * Reuses the resolver's own DecidingGrant output rather than inventing a
   * shape. Computed directly (not via the cached path), since this is a
   * one-off preview for an arbitrary target user, not the querying user's
   * own request — caching by "some other user's id" would just add cache
   * entries for a low-frequency admin action.
   *
   * Known limitation, not modeled here: if the target user is themselves a
   * tenant admin, this shows their plain resolved grants (often none) —
   * their real access comes from the caller-side admin bypass
   * (GroupsMembershipService/DocumentsPermissionsService's own rule), which
   * has no representation in the grants-based resolver this preview reads.
   */
  @Get(':id/effective-permission')
  async effectivePermission(@Param('id') id: string, @Query('userId') targetUserId?: string) {
    await this.requireTier(id, 'manage');
    id = id.toLowerCase(); // canonical form — see requireTier's own comment for why
    if (!targetUserId || !OBJECT_ID_RE.test(targetUserId)) throw new BadRequestException('userId query param is required');

    const allFolders = await this.folders.findAllForTenant();
    const targetMemberGroups = await this.groups.findForMember(toObjectId(targetUserId));
    const folders = toFolderInputs(allFolders);
    const principals = toPrincipalSet(targetUserId, targetMemberGroups);
    const resolution = resolveFolderPermissions(folders, principals);

    const tier: 'read' | 'edit' | 'manage' | null = resolution.permittedManage.includes(id)
      ? 'manage'
      : resolution.permittedEdit.includes(id)
        ? 'edit'
        : resolution.permittedRead.includes(id)
          ? 'read'
          : null;

    return { userId: targetUserId, folderId: id, tier, decidingGrant: resolution.decidingGrant.get(id) ?? null };
  }

  private grantsResponse(folder: FolderDocument) {
    return {
      id: folder._id.toString(),
      hasExplicitGrants: folder.hasExplicitGrants,
      isPublic: folder.isPublic,
      grants: folder.grants.map((g) => ({ principalType: g.principalType, principalId: g.principalId.toString(), access: g.access })),
    };
  }

  /**
   * ADR-0005's data-flow: bump `permVersion` in the same operation as the
   * grant write. This codebase uses no Mongo transactions, so the write
   * happens first and the bump second, best-effort: a grant that's written
   * but whose bump fails is safe (a stale cache just means late
   * propagation, self-healing on the next successful bump or the cache's
   * own TTL) — the reverse ordering would let a cache entry be built from
   * pre-change data and then be served as current, which is the genuinely
   * dangerous direction. The audit write is NOT best-effort (matches every
   * other controller's `auditEvents.record` usage in this codebase) — a
   * failure there fails the request.
   */
  private async bumpVersionAndAudit(folderId: string, action: string, metadata: Record<string, unknown>): Promise<void> {
    const scope = this.currentScope();
    try {
      await this.cache.bumpVersion(scope.tenantId.toString());
    } catch {
      // Best-effort — see method doc. A failed bump here is a stale-cache risk, not a correctness bug.
    }
    await this.auditEvents.record({ action, targetId: toObjectId(folderId), metadata });
  }

  private toCreatedSummary(folder: FolderDocument) {
    return {
      id: folder._id.toString(),
      name: folder.name,
      parentId: folder.parentId ? folder.parentId.toString() : null,
      hasExplicitGrants: folder.hasExplicitGrants,
      isPublic: folder.isPublic,
    };
  }

  /**
   * 404s on: malformed id, nonexistent folder, or a folder the caller can't reach at `tier`.
   * Returns the already-computed `resolution` too, so callers with a follow-up permission check
   * against the same scope (move()'s destination check) don't need a second
   * findAllForTenant()+resolveForCaller() round trip.
   */
  private async requireTier(id: string, tier: 'edit' | 'manage'): Promise<{ folder: FolderDocument; resolution: FolderPermissionResolution }> {
    if (!OBJECT_ID_RE.test(id)) throw new NotFoundException();
    // Canonical lowercase form: Mongoose ObjectId#toString() always lowercases, but OBJECT_ID_RE
    // (and the zod contracts) accept uppercase hex too — an uppercase-but-valid id would otherwise
    // silently fail every `f._id.toString() === id` / `permittedSet.includes(id)` comparison below.
    id = id.toLowerCase();

    const scope = this.currentScope();
    const allFolders = await this.folders.findAllForTenant();
    const folder = allFolders.find((f) => f._id.toString() === id);
    if (!folder) throw new NotFoundException();

    const resolution = await this.resolveForCaller(scope, allFolders);
    const permittedSet = tier === 'manage' ? resolution.permittedManage : resolution.permittedEdit;
    if (!permittedSet.includes(id)) throw new NotFoundException();

    return { folder, resolution };
  }

  private parseParentIdParam(parentIdParam: string | undefined): string | null {
    if (parentIdParam === undefined) return null; // no parentId -> roots
    if (!OBJECT_ID_RE.test(parentIdParam)) throw new BadRequestException('invalid parentId');
    return parentIdParam.toLowerCase();
  }

  /**
   * Tenant admins bypass folder grants entirely (PRD §7, same caller-side rule
   * DocumentsPermissionsService already applies) — synthesized here rather than
   * routed through the resolver, since there's nothing to compute or cache.
   */
  private async resolveForCaller(scope: Scope, allFolders: FolderDocument[]): Promise<FolderPermissionResolution> {
    if (scope.role === 'admin') {
      const ids = allFolders.map((f) => f._id.toString());
      return { permittedRead: ids, permittedEdit: ids, permittedManage: ids, decidingGrant: new Map() };
    }

    const memberGroups = await this.groups.findForMember(scope.userId);
    const folders = toFolderInputs(allFolders);
    const principals = toPrincipalSet(scope.userId.toString(), memberGroups);
    return resolveFolderPermissionsCached(this.cache, scope.tenantId.toString(), folders, principals);
  }

  /** Viewer-independent (ADR-0005) — computed once per tenant, unaffected by the admin bypass above. */
  private wideningForTenant(scope: Scope, allFolders: FolderDocument[]): Promise<Map<string, FolderWideningInfo>> {
    return computeFolderWideningCached(this.cache, scope.tenantId.toString(), toFolderInputs(allFolders));
  }

  private async groupNameLookup(): Promise<Map<string, string>> {
    const allGroups = await this.groups.findAllForTenant();
    return new Map(allGroups.map((g) => [g._id.toString(), g.name]));
  }

  /** No extra query — `allFolders` is already loaded by every caller of toSummary(). */
  private folderNameLookup(allFolders: FolderDocument[]): Map<string, string> {
    return new Map(allFolders.map((f) => [f._id.toString(), f.name]));
  }

  private toSummary(
    folder: FolderDocument,
    resolution: FolderPermissionResolution,
    widening: FolderWideningInfo | undefined,
    groupNames: Map<string, string>,
    folderNames: Map<string, string>,
  ): FolderSummary {
    const id = folder._id.toString();
    const tier: FolderSummary['tier'] = resolution.permittedManage.includes(id) ? 'manage' : resolution.permittedEdit.includes(id) ? 'edit' : 'read';

    return {
      id,
      name: folder.name,
      parentId: folder.parentId ? folder.parentId.toString() : null,
      hasExplicitGrants: folder.hasExplicitGrants,
      isPublic: folder.isPublic,
      tier,
      broaderThanParent: widening?.broaderThanParent ?? false,
      addedGroups: (widening?.addedGroups ?? []).map((groupId) => groupNames.get(groupId) ?? groupId),
      becamePublic: widening?.becamePublic ?? false,
      path: folder.path.map((ancestorId) => {
        const ancestorIdString = ancestorId.toString();
        return { id: ancestorIdString, name: folderNames.get(ancestorIdString) ?? ancestorIdString };
      }),
    };
  }

  private currentScope(): Scope {
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope) throw new Error('FoldersController: no scope in CLS — SessionAuthGuard should have populated it or rejected the request.');
    return scope;
  }
}
