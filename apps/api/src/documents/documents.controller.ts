import { createHash } from 'crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ClsService } from 'nestjs-cls';
import { Edition, UploadDocumentFormSchema, UploadDocumentResponse } from '@kms/contracts';
import { DocumentsRepository, DocumentVersionsRepository, TenantsRepository, SCOPE_CLS_KEY, Scope, toObjectId, newObjectId } from '@kms/data';
import { DocumentsPermissionsService } from './documents-permissions.service';
import { MulterExceptionFilter } from './multer-exception.filter';
import { MAX_UPLOAD_BYTES } from './upload-limits';
import { MIME_TYPES, sniffFileType } from './storage/magic-byte-sniff';
import { buildVersionObjectKey } from './storage/storage-provider';
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
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(INGESTION_QUEUE) private readonly ingestionQueue: IngestionQueue,
  ) {}

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
    await this.documents.createDocument({
      id: documentId,
      folderId: toObjectId(folderId),
      name: file.originalname,
      latestVersionId: version._id,
      createdBy: scope.userId,
    });

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
