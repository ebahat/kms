import { createHash } from 'crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ClsService } from 'nestjs-cls';
import {
  DeleteDocumentResponse,
  DownloadDocumentResponse,
  Edition,
  PurgeRecycleBinEntryResponse,
  RestoreDocumentResponse,
  UploadDocumentFormSchema,
  UploadDocumentResponse,
} from '@kms/contracts';
import {
  AuditEventsRepository,
  DeletionVerificationsRepository,
  DocumentsRepository,
  DocumentVersionsRepository,
  RecycleBinEntriesRepository,
  DEFAULT_RECYCLE_BIN_RETENTION_DAYS,
  TenantsRepository,
  SCOPE_CLS_KEY,
  Scope,
  toObjectId,
  newObjectId,
} from '@kms/data';
import { AdminOnlyGuard } from '../common/admin-only.guard';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';
import { DocumentsPermissionsService } from './documents-permissions.service';
import { MulterExceptionFilter } from './multer-exception.filter';
import { MAX_UPLOAD_BYTES } from './upload-limits';
import { MIME_TYPES, sniffFileType } from './storage/magic-byte-sniff';
import { buildVersionObjectKey } from './storage/storage-provider';
import { purgeEntryObjects } from './recycle-bin-purge';
import { STORAGE_PROVIDER, INGESTION_QUEUE, StorageProvider, IngestionQueue } from './documents.providers';

/** Local alias so this file never imports `mongoose` itself (ADR-0001 confines that to libs/data). */
type ObjectId = ReturnType<typeof newObjectId>;

/**
 * Upload path (ADR-0006/0003, PRD §8). Order is deliberate and matches
 * sec §4.4's ordering requirement: multer's fileSize limit bounds memory to
 * MAX_UPLOAD_BYTES before anything else runs -> magic-byte sniff (cheap,
 * local, rejects garbage/spoofed types before touching the DB) -> folder
 * permission check (ADR-0005, 404 on miss) -> quota gate -> storage write ->
 * documents/documentVersions records -> ingestion enqueue stub (Phase 3).
 */
@Controller()
@Edition('kb')
@UseFilters(MulterExceptionFilter)
export class DocumentsController {
  constructor(
    private readonly cls: ClsService,
    private readonly documents: DocumentsRepository,
    private readonly documentVersions: DocumentVersionsRepository,
    private readonly tenants: TenantsRepository,
    private readonly permissions: DocumentsPermissionsService,
    private readonly auditEvents: AuditEventsRepository,
    private readonly recycleBinEntries: RecycleBinEntriesRepository,
    private readonly deletionVerifications: DeletionVerificationsRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(INGESTION_QUEUE) private readonly ingestionQueue: IngestionQueue,
    private readonly notifications: NotificationDispatchService,
  ) {}

  /**
   * Download path (ADR-0006). Order matches the ADR: permission re-checked
   * at issuance time (never trusts a cached upload-time decision), then the
   * signed URL is issued, then the download is audited. `versionId` is
   * optional (defaults to latest) and is verified to actually belong to
   * this document — a versionId from a different document 404s rather than
   * serving a mismatched file.
   */
  @Get('documents/:id/download')
  async download(@Param('id') id: string, @Query('versionId') versionId?: string): Promise<DownloadDocumentResponse> {
    const documentId = toObjectId(id);
    const existing = await this.documents.findById(documentId);
    if (!existing) throw new NotFoundException();

    const canRead = await this.permissions.canRead(existing.folderId.toString());
    if (!canRead) throw new NotFoundException();

    const targetVersionId = versionId ? toObjectId(versionId) : existing.latestVersionId;
    const version = await this.documentVersions.findById(targetVersionId);
    if (!version || !version.documentId.equals(documentId)) throw new NotFoundException();

    const signed = await this.storage.getSignedDownloadUrl(version.storageKey, { displayFilename: version.originalFilename });

    await this.auditEvents.record({
      action: 'document.download',
      targetId: documentId,
      metadata: { versionId: version._id.toString(), versionNumber: version.versionNumber },
    });

    return signed;
  }

  /**
   * Delete path (PRD §8, sec §7.3). Requires manage tier, never edit alone.
   * Moves the document to the recycle bin: a full snapshot of every version
   * (enough to restore without depending on the now-deleted live rows) is
   * captured *before* the live Document/DocumentVersion rows are removed —
   * a crash between those two steps leaves both the entry and the live rows
   * intact, which is safe (worst case: briefly still visible, never lost).
   */
  @Delete('documents/:id')
  @HttpCode(200)
  async delete(@Param('id') id: string): Promise<DeleteDocumentResponse> {
    const documentId = toObjectId(id);
    const existing = await this.documents.findById(documentId);
    if (!existing) throw new NotFoundException();

    const canManage = await this.permissions.canManage(existing.folderId.toString());
    if (!canManage) throw new NotFoundException();

    const versions = await this.documentVersions.findByDocument(documentId);
    const scope = this.currentScope();
    const latestVersion = versions.find((v) => v._id.equals(existing.latestVersionId));

    const entry = await this.recycleBinEntries.createEntry({
      documentId,
      folderId: existing.folderId,
      name: existing.name,
      versions: versions.map((v) => ({
        versionNumber: v.versionNumber,
        storageKey: v.storageKey,
        originalFilename: v.originalFilename,
        mimeType: v.mimeType,
        sizeBytes: v.sizeBytes,
        contentHashSha256: v.contentHashSha256,
        uploadedBy: v.uploadedBy,
      })),
      deletedBy: scope.userId,
      purgeAfter: new Date(Date.now() + DEFAULT_RECYCLE_BIN_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    });

    await Promise.all(versions.map((v) => this.documentVersions.deleteOne({ _id: v._id })));
    await this.documents.deleteOne({ _id: documentId });

    await this.auditEvents.record({
      action: 'document.delete',
      targetId: documentId,
      metadata: { recycleBinEntryId: entry._id.toString(), contentHashSha256: latestVersion?.contentHashSha256 },
    });
    await this.notifications.notifyFileDeleted(existing);

    return { recycleBinEntryId: entry._id.toString() };
  }

  /** Recycle-bin operations are admin-only (PRD §7: "tenant admins can restore from or purge the recycle bin early"). */
  @Post('recycle-bin/:id/restore')
  @HttpCode(200)
  @UseGuards(AdminOnlyGuard)
  async restore(@Param('id') id: string): Promise<RestoreDocumentResponse> {
    const entryId = toObjectId(id);
    const entry = await this.recycleBinEntries.findById(entryId);
    if (!entry) throw new NotFoundException();
    if (entry.status !== 'pending') {
      throw new ConflictException({ error: 'RECYCLE_BIN_ENTRY_NOT_PENDING', message: `This item is already ${entry.status}.` });
    }

    const versionIds = entry.versions.map(() => newObjectId());
    const latestIndex = entry.versions.reduce((maxIdx, v, idx, arr) => (v.versionNumber > arr[maxIdx].versionNumber ? idx : maxIdx), 0);

    for (let i = 0; i < entry.versions.length; i++) {
      const v = entry.versions[i];
      await this.documentVersions.createVersion({
        id: versionIds[i],
        documentId: entry.documentId,
        versionNumber: v.versionNumber,
        storageKey: v.storageKey,
        originalFilename: v.originalFilename,
        mimeType: v.mimeType,
        sizeBytes: v.sizeBytes,
        contentHashSha256: v.contentHashSha256,
        uploadedBy: v.uploadedBy,
      });
    }

    await this.documents.createDocument({
      id: entry.documentId,
      folderId: entry.folderId,
      name: entry.name,
      latestVersionId: versionIds[latestIndex],
      createdBy: entry.deletedBy,
    });

    await this.recycleBinEntries.markRestored(entryId);
    await this.auditEvents.record({ action: 'document.restore', targetId: entry.documentId, metadata: { recycleBinEntryId: entryId.toString() } });

    return { documentId: entry.documentId.toString() };
  }

  /** Early purge (admin-only, same reasoning as restore) — the scheduled sweep (runRecycleBinPurge) reuses purgeEntryObjects for the same real work once it's wired to a scheduler (Phase 3/6). */
  @Post('recycle-bin/:id/purge')
  @HttpCode(200)
  @UseGuards(AdminOnlyGuard)
  async purgeEarly(@Param('id') id: string): Promise<PurgeRecycleBinEntryResponse> {
    const entryId = toObjectId(id);
    const entry = await this.recycleBinEntries.findById(entryId);
    if (!entry) throw new NotFoundException();
    if (entry.status !== 'pending') {
      throw new ConflictException({ error: 'RECYCLE_BIN_ENTRY_NOT_PENDING', message: `This item is already ${entry.status}.` });
    }

    const objectKeys = entry.versions.map((v) => v.storageKey);
    const result = await purgeEntryObjects(objectKeys, this.storage);

    await this.deletionVerifications.record({
      recycleBinEntryId: entryId,
      objectKeysChecked: result.objectKeysChecked,
      objectKeysStillPresent: result.objectKeysStillPresent,
      passed: result.passed,
      notes: result.notes,
    });
    if (result.passed) await this.recycleBinEntries.markPurged(entryId);

    await this.auditEvents.record({
      action: 'document.purge',
      targetId: entry.documentId,
      metadata: { recycleBinEntryId: entryId.toString(), passed: result.passed },
    });

    return { verified: result.passed };
  }

  @Post('documents')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(@UploadedFile() uploaded: Express.Multer.File | undefined, @Body() body: unknown): Promise<UploadDocumentResponse> {
    const { folderId } = UploadDocumentFormSchema.parse(body);
    const { file, sniffed } = this.requireValidFile(uploaded);

    const canUpload = await this.permissions.canUploadTo(folderId);
    if (!canUpload) throw new NotFoundException();
    await this.assertWithinQuota(file.size);

    const scope = this.currentScope();
    const documentId = newObjectId();
    const versionId = newObjectId();
    const version = await this.writeVersion({
      documentId,
      versionId,
      versionNumber: 1,
      file,
      sniffed,
      uploadedBy: scope.userId,
      tenantId: scope.tenantId,
    });

    // Storage + version are already durable at this point; a crash between here and
    // createDocument leaves an orphaned DocumentVersion with no parent Document — dead,
    // invisible data (nothing queries versions except through their document), never a
    // correctness or cross-tenant issue. Same accepted-risk class as ADR-0005's permVersion bump.
    const created = await this.documents.createDocument({
      id: documentId,
      folderId: toObjectId(folderId),
      name: file.originalname,
      latestVersionId: version._id,
      createdBy: scope.userId,
    });

    await this.auditEvents.record({
      action: 'document.upload',
      targetId: documentId,
      metadata: { folderId, versionId: version._id.toString(), versionNumber: 1 },
    });
    await this.notifications.notifyFileAdded(created);

    this.ingestionQueue.enqueueScan({ tenantId: scope.tenantId.toString(), documentId: documentId.toString(), versionId: version._id.toString() });
    return { documentId: documentId.toString(), versionId: version._id.toString(), versionNumber: 1, status: 'queued' };
  }

  @Post('documents/:id/versions')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadNewVersion(@Param('id') id: string, @UploadedFile() uploaded: Express.Multer.File | undefined): Promise<UploadDocumentResponse> {
    const documentId = toObjectId(id);
    const existing = await this.documents.findById(documentId);
    if (!existing) throw new NotFoundException();

    const { file, sniffed } = this.requireValidFile(uploaded);

    const canUpload = await this.permissions.canUploadTo(existing.folderId.toString());
    if (!canUpload) throw new NotFoundException();
    await this.assertWithinQuota(file.size);

    const scope = this.currentScope();
    const versionId = newObjectId();
    const nextVersionNumber = (await this.documentVersions.latestVersionNumber(documentId)) + 1;
    const version = await this.writeVersion({
      documentId,
      versionId,
      versionNumber: nextVersionNumber,
      file,
      sniffed,
      uploadedBy: scope.userId,
      tenantId: scope.tenantId,
    });

    await this.documents.setLatestVersion(documentId, version._id);
    this.ingestionQueue.enqueueScan({ tenantId: scope.tenantId.toString(), documentId: documentId.toString(), versionId: version._id.toString() });
    return { documentId: documentId.toString(), versionId: version._id.toString(), versionNumber: nextVersionNumber, status: 'queued' };
  }

  /** Storage-first: the bytes are durably written before any Mongo record references them (see DocumentVersionsRepository.createVersion). */
  private async writeVersion(args: {
    documentId: ObjectId;
    versionId: ObjectId;
    versionNumber: number;
    file: Express.Multer.File;
    sniffed: keyof typeof MIME_TYPES;
    uploadedBy: ObjectId;
    tenantId: ObjectId;
  }) {
    const storageKey = buildVersionObjectKey(args.tenantId.toString(), args.versionId.toString());
    await this.storage.putObject(storageKey, args.file.buffer, { contentType: MIME_TYPES[args.sniffed] });

    return this.documentVersions.createVersion({
      id: args.versionId,
      documentId: args.documentId,
      versionNumber: args.versionNumber,
      storageKey,
      originalFilename: args.file.originalname,
      mimeType: MIME_TYPES[args.sniffed],
      sizeBytes: args.file.size,
      contentHashSha256: createHash('sha256').update(args.file.buffer).digest('hex'),
      uploadedBy: args.uploadedBy,
    });
  }

  private requireValidFile(file: Express.Multer.File | undefined): { file: Express.Multer.File; sniffed: keyof typeof MIME_TYPES } {
    if (!file) throw new BadRequestException({ error: 'FILE_REQUIRED' });
    const sniffed = sniffFileType(file.buffer);
    if (!sniffed) {
      throw new UnsupportedMediaTypeException({ error: 'UNSUPPORTED_FILE_TYPE', message: 'Allowed types: PDF, DOCX, JPG, PNG.' });
    }
    return { file, sniffed };
  }

  /**
   * Read-then-compare, not atomic — two concurrent uploads can both pass this
   * check and jointly push the tenant slightly over quota. Accepted: this is
   * a soft, alert-driven limit (PRD §4's 80%/95% admin alerts), not a
   * security boundary, and MVP concurrency is low.
   */
  private async assertWithinQuota(additionalBytes: number): Promise<void> {
    const scope = this.currentScope();
    const [used, tenant] = await Promise.all([this.documentVersions.sumSizeForTenant(), this.tenants.findById(scope.tenantId)]);
    const quota = tenant?.storageQuotaBytes ?? 0;
    if (used + additionalBytes > quota) {
      throw new ConflictException({
        error: 'STORAGE_QUOTA_EXCEEDED',
        message: 'This tenant has reached its storage quota. Delete unused documents or contact your administrator to increase it.',
      });
    }
  }

  /** The auth guard always runs first and populates this — a missing scope here would mean the guard chain itself is broken. */
  private currentScope(): Scope {
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope) throw new Error('DocumentsController: no scope in CLS — SessionAuthGuard should have populated it or rejected the request.');
    return scope;
  }
}
