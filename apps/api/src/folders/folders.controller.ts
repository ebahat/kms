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
  MoveFolderRequestSchema,
  RenameFolderRequestSchema,
} from '@kms/contracts';
import {
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
    return children.map((f) => this.toSummary(f, resolution, widening.get(f._id.toString()), groupNames));
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    if (!OBJECT_ID_RE.test(id)) throw new NotFoundException();

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
    const summary = this.toSummary(folder, resolution, widening.get(id), groupNames);

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
    const { parentId, name } = CreateFolderRequestSchema.parse(body);
    const scope = this.currentScope();

    if (parentId === null) {
      // No parent to hold an `edit` grant — creating a root folder is a tenant-admin action, not a
      // hidden-resource case, so this is a real 403 rather than the usual 404-on-denial convention.
      if (scope.role !== 'admin') throw new ForbiddenException();
      const created = await this.folders.createFolder({ name, parentId: null });
      return this.toCreatedSummary(created);
    }

    const allFolders = await this.folders.findAllForTenant();
    const resolution = await this.resolveForCaller(scope, allFolders);
    // Not in permittedEdit covers both "doesn't exist" and "caller can't add content here" —
    // FoldersRepository.createFolder's own FolderParentNotFoundError is the defense-in-depth
    // backstop behind this, not the primary check (Task 1).
    if (!resolution.permittedEdit.includes(parentId)) throw new NotFoundException();

    const created = await this.folders.createFolder({ name, parentId: toObjectId(parentId) });
    return this.toCreatedSummary(created);
  }

  @Patch(':id')
  async rename(@Param('id') id: string, @Body() body: unknown) {
    const { name } = RenameFolderRequestSchema.parse(body);
    await this.requireTier(id, 'manage');
    const updated = await this.folders.renameFolder(toObjectId(id), name);
    if (!updated) throw new NotFoundException();
    return { id, name: updated.name };
  }

  @Patch(':id/move')
  async move(@Param('id') id: string, @Body() body: unknown) {
    const { parentId } = MoveFolderRequestSchema.parse(body);
    const { folder } = await this.requireTier(id, 'manage');
    const scope = this.currentScope();

    if (parentId === null) {
      // Moving to root is structurally the same act as creating at root — no parent to hold an
      // `edit` grant, so it's the same tenant-admin-only rule as create(), not a hidden-resource case.
      if (scope.role !== 'admin') throw new ForbiddenException();
    } else {
      // The destination must be somewhere the caller can add content — moving into a folder they
      // can't edit would let them park content somewhere they couldn't have created it directly.
      const allFolders = await this.folders.findAllForTenant();
      const resolution = await this.resolveForCaller(scope, allFolders);
      if (!resolution.permittedEdit.includes(parentId)) throw new NotFoundException();
    }

    const moved = await this.folders.moveFolder(folder._id, parentId ? toObjectId(parentId) : null);
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
    return { deleted: true };
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

  /** 404s on: malformed id, nonexistent folder, or a folder the caller can't reach at `tier`. */
  private async requireTier(id: string, tier: 'edit' | 'manage'): Promise<{ folder: FolderDocument }> {
    if (!OBJECT_ID_RE.test(id)) throw new NotFoundException();

    const scope = this.currentScope();
    const allFolders = await this.folders.findAllForTenant();
    const folder = allFolders.find((f) => f._id.toString() === id);
    if (!folder) throw new NotFoundException();

    const resolution = await this.resolveForCaller(scope, allFolders);
    const permittedSet = tier === 'manage' ? resolution.permittedManage : resolution.permittedEdit;
    if (!permittedSet.includes(id)) throw new NotFoundException();

    return { folder };
  }

  private parseParentIdParam(parentIdParam: string | undefined): string | null {
    if (parentIdParam === undefined) return null; // no parentId -> roots
    if (!OBJECT_ID_RE.test(parentIdParam)) throw new BadRequestException('invalid parentId');
    return parentIdParam;
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

  private toSummary(
    folder: FolderDocument,
    resolution: FolderPermissionResolution,
    widening: FolderWideningInfo | undefined,
    groupNames: Map<string, string>,
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
    };
  }

  private currentScope(): Scope {
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope) throw new Error('FoldersController: no scope in CLS — SessionAuthGuard should have populated it or rejected the request.');
    return scope;
  }
}
