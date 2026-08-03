import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { FoldersRepository, GroupsRepository, MissingScopeError, SCOPE_CLS_KEY, Scope } from '@kms/data';
import { PermissionCache, resolveFolderPermissionsCached, toFolderInputs, toPrincipalSet } from '@kms/permissions';
import { PERMISSION_CACHE } from '../redis.provider';

/**
 * The first real consumer of libs/permissions' resolver (ADR-0005). Tenant
 * admins bypass folder grants entirely (PRD §7 "tenant admins can CRUD any
 * directory in their tenant regardless of grants" — a caller-side rule per
 * ADR-0005's Consumption points, not baked into the resolver itself), but a
 * nonexistent folderId is still rejected for everyone, admin included.
 */
@Injectable()
export class DocumentsPermissionsService {
  constructor(
    private readonly cls: ClsService,
    private readonly folders: FoldersRepository,
    private readonly groups: GroupsRepository,
    @Inject(PERMISSION_CACHE) private readonly cache: PermissionCache,
  ) {}

  /** Upload path (Phase 2.3): can the current user create/replace content in this folder? */
  canUploadTo(folderId: string): Promise<boolean> {
    return this.hasAccess(folderId, 'edit');
  }

  /** Download path (Phase 2.4, ADR-0006): re-checked at signed-URL issuance time, never cached across requests. */
  canRead(folderId: string): Promise<boolean> {
    return this.hasAccess(folderId, 'read');
  }

  private async hasAccess(folderId: string, tier: 'read' | 'edit'): Promise<boolean> {
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope) throw new MissingScopeError('DocumentsPermissionsService');

    const folderDocs = await this.folders.findAllForTenant();
    const folderExists = folderDocs.some((f) => f._id.toString() === folderId);
    if (!folderExists) return false;
    if (scope.role === 'admin') return true;

    const groupDocs = await this.groups.findForMember(scope.userId);
    const folders = toFolderInputs(folderDocs);
    const principals = toPrincipalSet(scope.userId.toString(), groupDocs);

    const resolution = await resolveFolderPermissionsCached(this.cache, scope.tenantId.toString(), folders, principals);
    return (tier === 'edit' ? resolution.permittedEdit : resolution.permittedRead).includes(folderId);
  }
}
