import { Body, Controller, Delete, Get, NotFoundException, Param, Post, UseFilters } from '@nestjs/common';
import { Edition } from '@kms/contracts';
import { AddFavoriteRequestSchema, FavoriteSummary, RemoveFavoriteResponse } from '@kms/contracts';
import { AuditEventsRepository, DocumentsRepository, FavoriteDocument, FavoritesRepository, FavoriteTargetType, FoldersRepository, toObjectId } from '@kms/data';
import { DocumentsPermissionsService } from '../documents/documents-permissions.service';
import { FolderExceptionFilter } from '../folders/folder-exception.filter';

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/** MongoServerError E11000 — the only error shape a unique-index collision can throw here. */
function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 11000;
}

/**
 * Per-user bookmarks (product-gaps batch, 2026-08-29 item 7). No admin bypass — these are private
 * lists, not tenant-shared state, so `FavoritesRepository`'s owner scoping is the only
 * authorization this controller needs for add/remove. Read access to the *target* is re-checked
 * on every add and on every list (never trusts a cached decision from favorite time, same
 * principle as `ChatController.getCitation`) — a favorite must never let a user see a
 * document/folder name they've since lost access to, or one that's since been deleted.
 */
@Controller('favorites')
@Edition('kb')
@UseFilters(FolderExceptionFilter)
export class FavoritesController {
  constructor(
    private readonly favorites: FavoritesRepository,
    private readonly documents: DocumentsRepository,
    private readonly folders: FoldersRepository,
    private readonly permissions: DocumentsPermissionsService,
    private readonly auditEvents: AuditEventsRepository,
  ) {}

  @Post()
  async add(@Body() body: unknown): Promise<FavoriteSummary> {
    const patch = AddFavoriteRequestSchema.parse(body);
    const targetId = toObjectId(patch.targetId);

    const target = await this.resolveTarget(patch.targetType, targetId);
    if (!target) throw new NotFoundException();
    const canRead = await this.permissions.canRead(target.folderId);
    if (!canRead) throw new NotFoundException();

    const existing = await this.favorites.findOne(patch.targetType, targetId);
    if (existing) return this.toSummary(existing, target);

    // Check-then-create race: two concurrent adds for the same target can both pass the findOne
    // check above and then collide on the schema's unique index — caught here and treated as the
    // same idempotent success, rather than surfacing as an uncaught Mongo duplicate-key 500.
    let favorite: FavoriteDocument;
    try {
      favorite = await this.favorites.addFavorite(patch.targetType, targetId);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        const winner = await this.favorites.findOne(patch.targetType, targetId);
        if (winner) return this.toSummary(winner, target);
      }
      throw err;
    }
    await this.auditEvents.record({ action: 'favorite.added', targetId, metadata: { targetType: patch.targetType } });
    return this.toSummary(favorite, target);
  }

  /**
   * Newest-first. Silently drops any favorite whose target was deleted or whose permission has
   * since been revoked — never leaks a stale name. Resolves the permitted-folder set once
   * (`permittedReadFolderIds`, the same bulk primitive chat's retrieval pre-filter uses) rather
   * than re-running folder/group resolution per favorite — the original per-row `canRead` here
   * was an N+1 (and, with no cap on favorite count, a self-inflicted DoS surface).
   */
  @Get()
  async list(): Promise<FavoriteSummary[]> {
    const rows = await this.favorites.listForOwner();
    const permittedFolderIds = new Set(await this.permissions.permittedReadFolderIds());
    const results: FavoriteSummary[] = [];
    for (const row of rows) {
      const target = await this.resolveTarget(row.targetType, row.targetId);
      if (!target) continue;
      if (!permittedFolderIds.has(target.folderId)) continue;
      results.push(this.toSummary(row, target));
    }
    return results;
  }

  @Delete(':targetType/:targetId')
  async remove(@Param('targetType') targetType: string, @Param('targetId') targetId: string): Promise<RemoveFavoriteResponse> {
    if (targetType !== 'document' && targetType !== 'folder') throw new NotFoundException();
    if (!OBJECT_ID_RE.test(targetId)) throw new NotFoundException();
    const id = toObjectId(targetId);
    const existing = await this.favorites.findOne(targetType, id);
    if (!existing) throw new NotFoundException();

    await this.favorites.removeFavorite(targetType, id);
    await this.auditEvents.record({ action: 'favorite.removed', targetId: id, metadata: { targetType } });
    return { removed: true };
  }

  private async resolveTarget(
    targetType: FavoriteTargetType,
    targetId: ReturnType<typeof toObjectId>,
  ): Promise<{ name: string; folderId: string } | null> {
    if (targetType === 'folder') {
      const folder = await this.folders.findById(targetId);
      return folder ? { name: folder.name, folderId: targetId.toString() } : null;
    }
    const doc = await this.documents.findById(targetId);
    return doc ? { name: doc.name, folderId: doc.folderId.toString() } : null;
  }

  private toSummary(row: FavoriteDocument, target: { name: string; folderId: string }): FavoriteSummary {
    return {
      id: row._id.toString(),
      targetType: row.targetType,
      targetId: row.targetId.toString(),
      name: target.name,
      folderId: target.folderId,
      createdAt: row.createdAt,
    };
  }
}
