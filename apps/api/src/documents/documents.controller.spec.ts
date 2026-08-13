import { BadRequestException, ConflictException, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import { newObjectId } from '@kms/data';
import { DocumentsController } from './documents.controller';

const PDF_BYTES = Buffer.from('%PDF-1.4\n%mock pdf content for tests');

function fakeMulterFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return { buffer: PDF_BYTES, size: PDF_BYTES.length, originalname: 'report.pdf', mimetype: 'application/pdf', ...overrides } as Express.Multer.File;
}

describe('DocumentsController (upload path — ADR-0006/0003, PRD §8)', () => {
  const tenantId = newObjectId();
  const userId = newObjectId();
  const folderId = newObjectId();

  let cls: any;
  let documents: any;
  let documentVersions: any;
  let tenants: any;
  let permissions: any;
  let auditEvents: any;
  let recycleBinEntries: any;
  let deletionVerifications: any;
  let storage: any;
  let ingestionQueue: any;
  let notifications: any;
  let controller: DocumentsController;

  beforeEach(() => {
    cls = { get: jest.fn().mockReturnValue({ tenantId, userId, role: 'user', edition: 'kb' }) };
    documents = {
      createDocument: jest.fn().mockImplementation((doc) => Promise.resolve({ _id: doc.id ?? newObjectId(), ...doc })),
      findById: jest.fn(),
      findByFolder: jest.fn().mockResolvedValue([]),
      setLatestVersion: jest.fn().mockResolvedValue(undefined),
      deleteOne: jest.fn().mockResolvedValue(undefined),
    };
    documentVersions = {
      createVersion: jest.fn().mockImplementation((doc) => Promise.resolve({ _id: doc.id ?? newObjectId() })),
      sumSizeForTenant: jest.fn().mockResolvedValue(0),
      latestVersionNumber: jest.fn().mockResolvedValue(1),
      findById: jest.fn(),
      findByDocument: jest.fn().mockResolvedValue([]),
      deleteOne: jest.fn().mockResolvedValue(undefined),
    };
    tenants = { findById: jest.fn().mockResolvedValue({ storageQuotaBytes: 1_073_741_824 }) };
    permissions = {
      canUploadTo: jest.fn().mockResolvedValue(true),
      canRead: jest.fn().mockResolvedValue(true),
      canManage: jest.fn().mockResolvedValue(true),
    };
    auditEvents = { record: jest.fn().mockResolvedValue(undefined) };
    recycleBinEntries = {
      createEntry: jest.fn().mockResolvedValue({ _id: newObjectId() }),
      findById: jest.fn(),
      markRestored: jest.fn().mockResolvedValue(undefined),
      markPurged: jest.fn().mockResolvedValue(undefined),
    };
    deletionVerifications = { record: jest.fn().mockResolvedValue(undefined) };
    storage = {
      putObject: jest.fn().mockResolvedValue(undefined),
      getSignedDownloadUrl: jest.fn().mockResolvedValue({ url: 'https://signed.example/x', expiresAt: new Date('2026-01-01T00:05:00Z') }),
      objectExists: jest.fn().mockResolvedValue(false),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    ingestionQueue = { enqueueScan: jest.fn() };
    notifications = { notifyFileAdded: jest.fn().mockResolvedValue(undefined), notifyFileDeleted: jest.fn().mockResolvedValue(undefined) };
    controller = new DocumentsController(
      cls,
      documents,
      documentVersions,
      tenants,
      permissions,
      auditEvents,
      recycleBinEntries,
      deletionVerifications,
      storage,
      ingestionQueue,
      notifications,
    );
  });

  describe('upload (new document)', () => {
    it('writes storage before creating any Mongo record, then creates version + document and enqueues scan', async () => {
      const result = await controller.upload(fakeMulterFile(), { folderId: folderId.toString() });

      expect(storage.putObject).toHaveBeenCalledWith(expect.stringContaining(tenantId.toString()), PDF_BYTES, { contentType: 'application/pdf' });
      expect(documentVersions.createVersion).toHaveBeenCalledWith(expect.objectContaining({ versionNumber: 1, sizeBytes: PDF_BYTES.length }));
      expect(documents.createDocument).toHaveBeenCalledWith(expect.objectContaining({ folderId, name: 'report.pdf' }));
      expect(ingestionQueue.enqueueScan).toHaveBeenCalledWith(expect.objectContaining({ tenantId: tenantId.toString() }));
      expect(result).toEqual(expect.objectContaining({ versionNumber: 1, status: 'queued' }));
    });

    it('records an audit event for the upload and sends the fileAdded notification', async () => {
      await controller.upload(fakeMulterFile(), { folderId: folderId.toString() });

      expect(auditEvents.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'document.upload', metadata: expect.objectContaining({ folderId: folderId.toString(), versionNumber: 1 }) }),
      );
      expect(notifications.notifyFileAdded).toHaveBeenCalledWith(expect.objectContaining({ folderId, name: 'report.pdf' }));
    });

    it('rejects with no file', async () => {
      await expect(controller.upload(undefined, { folderId: folderId.toString() })).rejects.toThrow(BadRequestException);
      expect(permissions.canUploadTo).not.toHaveBeenCalled();
    });

    it('rejects a file whose bytes do not match any supported type, before ever checking permissions', async () => {
      const badFile = fakeMulterFile({ buffer: Buffer.from('not a real document'), originalname: 'fake.pdf' });
      await expect(controller.upload(badFile, { folderId: folderId.toString() })).rejects.toThrow(UnsupportedMediaTypeException);
      expect(permissions.canUploadTo).not.toHaveBeenCalled();
    });

    it('returns 404 (never 403) when the user lacks edit access to the folder, without checking quota', async () => {
      permissions.canUploadTo.mockResolvedValue(false);
      await expect(controller.upload(fakeMulterFile(), { folderId: folderId.toString() })).rejects.toThrow(NotFoundException);
      expect(documentVersions.sumSizeForTenant).not.toHaveBeenCalled();
    });

    it('rejects with a conflict when the upload would exceed the tenant storage quota, before writing to storage', async () => {
      documentVersions.sumSizeForTenant.mockResolvedValue(1_073_741_824 - 10); // 10 bytes of headroom
      await expect(controller.upload(fakeMulterFile(), { folderId: folderId.toString() })).rejects.toThrow(ConflictException);
      expect(storage.putObject).not.toHaveBeenCalled();
    });

    it('rejects a malformed folderId before any repository call', async () => {
      await expect(controller.upload(fakeMulterFile(), { folderId: 'not-an-object-id' })).rejects.toThrow();
      expect(permissions.canUploadTo).not.toHaveBeenCalled();
    });
  });

  describe('uploadNewVersion', () => {
    it('returns 404 for a document that does not exist in this tenant', async () => {
      documents.findById.mockResolvedValue(null);
      await expect(controller.uploadNewVersion(newObjectId().toString(), fakeMulterFile())).rejects.toThrow(NotFoundException);
    });

    it('checks permission against the existing document\'s own folder, not a caller-supplied one', async () => {
      const documentId = newObjectId();
      documents.findById.mockResolvedValue({ _id: documentId, folderId });
      documentVersions.latestVersionNumber.mockResolvedValue(2);

      const result = await controller.uploadNewVersion(documentId.toString(), fakeMulterFile());

      expect(permissions.canUploadTo).toHaveBeenCalledWith(folderId.toString());
      expect(documentVersions.createVersion).toHaveBeenCalledWith(expect.objectContaining({ versionNumber: 3, documentId }));
      expect(documents.setLatestVersion).toHaveBeenCalledWith(documentId, expect.anything());
      expect(result.versionNumber).toBe(3);
    });
  });

  describe('download (ADR-0006)', () => {
    const documentId = newObjectId();
    const versionId = newObjectId();

    beforeEach(() => {
      documents.findById.mockResolvedValue({ _id: documentId, folderId, latestVersionId: versionId });
      documentVersions.findById.mockResolvedValue({
        _id: versionId,
        documentId,
        versionNumber: 2,
        storageKey: 'tenants/x/versions/y',
        originalFilename: 'report.pdf',
      });
    });

    it('returns the signed URL for the latest version when no versionId is given', async () => {
      const result = await controller.download(documentId.toString());

      expect(permissions.canRead).toHaveBeenCalledWith(folderId.toString());
      expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('tenants/x/versions/y', { displayFilename: 'report.pdf' });
      expect(result).toEqual({ url: 'https://signed.example/x', expiresAt: new Date('2026-01-01T00:05:00Z') });
    });

    it('records an audit event with the document and version identifiers', async () => {
      await controller.download(documentId.toString());

      expect(auditEvents.record).toHaveBeenCalledWith({
        action: 'document.download',
        targetId: documentId,
        metadata: { versionId: versionId.toString(), versionNumber: 2 },
      });
    });

    it('returns 404 for a document that does not exist in this tenant', async () => {
      documents.findById.mockResolvedValue(null);
      await expect(controller.download(newObjectId().toString())).rejects.toThrow(NotFoundException);
    });

    it('re-checks permission at issuance time — returns 404 (never 403) when denied, before touching storage', async () => {
      permissions.canRead.mockResolvedValue(false);
      await expect(controller.download(documentId.toString())).rejects.toThrow(NotFoundException);
      expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('returns 404 for a versionId that does not belong to this document, rather than serving a mismatched file', async () => {
      const otherDocumentVersionId = newObjectId();
      documentVersions.findById.mockResolvedValue({
        _id: otherDocumentVersionId,
        documentId: newObjectId(), // a real ObjectId for a different document — its native .equals() correctly returns false
      });

      await expect(controller.download(documentId.toString(), otherDocumentVersionId.toString())).rejects.toThrow(NotFoundException);
      expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('returns 404 for a versionId that does not exist at all', async () => {
      documentVersions.findById.mockResolvedValue(null);
      await expect(controller.download(documentId.toString(), newObjectId().toString())).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete (PRD §8, sec §7.3)', () => {
    const documentId = newObjectId();
    const latestVersionId = newObjectId();
    const versions = [
      { _id: newObjectId(), versionNumber: 1, storageKey: 'k1', originalFilename: 'v1.pdf', mimeType: 'application/pdf', sizeBytes: 10, contentHashSha256: 'h1', uploadedBy: userId },
      { _id: latestVersionId, versionNumber: 2, storageKey: 'k2', originalFilename: 'v2.pdf', mimeType: 'application/pdf', sizeBytes: 20, contentHashSha256: 'h2', uploadedBy: userId },
    ];

    beforeEach(() => {
      documents.findById.mockResolvedValue({ _id: documentId, folderId, name: 'report.pdf', latestVersionId });
      documentVersions.findByDocument.mockResolvedValue(versions);
    });

    it('requires manage tier, not just edit', async () => {
      await controller.delete(documentId.toString());
      expect(permissions.canManage).toHaveBeenCalledWith(folderId.toString());
    });

    it('returns 404 (never 403) when the user lacks manage access', async () => {
      permissions.canManage.mockResolvedValue(false);
      await expect(controller.delete(documentId.toString())).rejects.toThrow(NotFoundException);
      expect(recycleBinEntries.createEntry).not.toHaveBeenCalled();
    });

    it('returns 404 for a document that does not exist in this tenant', async () => {
      documents.findById.mockResolvedValue(null);
      await expect(controller.delete(newObjectId().toString())).rejects.toThrow(NotFoundException);
    });

    it('creates a recycle-bin entry snapshotting every version before removing the live rows', async () => {
      await controller.delete(documentId.toString());

      expect(recycleBinEntries.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId,
          folderId,
          name: 'report.pdf',
          versions: expect.arrayContaining([expect.objectContaining({ versionNumber: 1, storageKey: 'k1' }), expect.objectContaining({ versionNumber: 2, storageKey: 'k2' })]),
        }),
      );
      expect(documentVersions.deleteOne).toHaveBeenCalledTimes(2);
      expect(documents.deleteOne).toHaveBeenCalledWith({ _id: documentId });
    });

    it('audits the deletion with the latest version\'s content hash', async () => {
      await controller.delete(documentId.toString());

      expect(auditEvents.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'document.delete', targetId: documentId, metadata: expect.objectContaining({ contentHashSha256: 'h2' }) }),
      );
    });

    it('sends the fileDeleted notification', async () => {
      await controller.delete(documentId.toString());

      expect(notifications.notifyFileDeleted).toHaveBeenCalledWith(expect.objectContaining({ _id: documentId, folderId }));
    });
  });

  describe('restore (admin-only, PRD §7)', () => {
    const entryId = newObjectId();
    const documentId = newObjectId();
    const deletedBy = newObjectId();

    beforeEach(() => {
      recycleBinEntries.findById.mockResolvedValue({
        _id: entryId,
        documentId,
        folderId,
        name: 'report.pdf',
        status: 'pending',
        deletedBy,
        versions: [
          { versionNumber: 1, storageKey: 'k1', originalFilename: 'v1.pdf', mimeType: 'application/pdf', sizeBytes: 10, contentHashSha256: 'h1', uploadedBy: userId },
          { versionNumber: 2, storageKey: 'k2', originalFilename: 'v2.pdf', mimeType: 'application/pdf', sizeBytes: 20, contentHashSha256: 'h2', uploadedBy: userId },
        ],
      });
    });

    it('returns 404 for an entry that does not exist', async () => {
      recycleBinEntries.findById.mockResolvedValue(null);
      await expect(controller.restore(newObjectId().toString())).rejects.toThrow(NotFoundException);
    });

    it('rejects with a conflict when the entry is no longer pending', async () => {
      recycleBinEntries.findById.mockResolvedValue({ _id: entryId, status: 'purged' });
      await expect(controller.restore(entryId.toString())).rejects.toThrow(ConflictException);
    });

    it('recreates every version and the document under its original id, pointing latestVersionId at the highest versionNumber', async () => {
      const result = await controller.restore(entryId.toString());

      expect(documentVersions.createVersion).toHaveBeenCalledWith(expect.objectContaining({ versionNumber: 1, documentId }));
      expect(documentVersions.createVersion).toHaveBeenCalledWith(expect.objectContaining({ versionNumber: 2, documentId }));
      expect(documents.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: documentId, folderId, name: 'report.pdf', createdBy: deletedBy }),
      );
      expect(recycleBinEntries.markRestored).toHaveBeenCalledWith(entryId);
      expect(result.documentId).toBe(documentId.toString());
    });
  });

  describe('purgeEarly (admin-only)', () => {
    const entryId = newObjectId();
    const documentId = newObjectId();

    beforeEach(() => {
      recycleBinEntries.findById.mockResolvedValue({
        _id: entryId,
        documentId,
        status: 'pending',
        versions: [{ storageKey: 'k1' }, { storageKey: 'k2' }],
      });
    });

    it('returns 404 for an entry that does not exist', async () => {
      recycleBinEntries.findById.mockResolvedValue(null);
      await expect(controller.purgeEarly(newObjectId().toString())).rejects.toThrow(NotFoundException);
    });

    it('rejects with a conflict when the entry is no longer pending', async () => {
      recycleBinEntries.findById.mockResolvedValue({ _id: entryId, status: 'restored' });
      await expect(controller.purgeEarly(entryId.toString())).rejects.toThrow(ConflictException);
    });

    it('deletes every object key, records a passing verification, and marks the entry purged', async () => {
      const result = await controller.purgeEarly(entryId.toString());

      expect(storage.deleteObject).toHaveBeenCalledWith('k1');
      expect(storage.deleteObject).toHaveBeenCalledWith('k2');
      expect(deletionVerifications.record).toHaveBeenCalledWith(expect.objectContaining({ recycleBinEntryId: entryId, passed: true }));
      expect(recycleBinEntries.markPurged).toHaveBeenCalledWith(entryId);
      expect(result.verified).toBe(true);
    });

    it('does not mark the entry purged when an object survives deletion', async () => {
      storage.objectExists.mockResolvedValue(true); // simulates a delete that silently no-ops
      const result = await controller.purgeEarly(entryId.toString());

      expect(recycleBinEntries.markPurged).not.toHaveBeenCalled();
      expect(result.verified).toBe(false);
    });
  });

  describe('listByFolder (Phase 2 UI plan Task 1)', () => {
    it('404s a folder the caller cannot read', async () => {
      permissions.canRead.mockResolvedValue(false);

      await expect(controller.listByFolder(folderId.toString())).rejects.toThrow(NotFoundException);
      expect(documents.findByFolder).not.toHaveBeenCalled();
    });

    it('returns an empty array for a readable, empty folder', async () => {
      const result = await controller.listByFolder(folderId.toString());
      expect(result).toEqual([]);
    });

    it('returns a summary per document, joined with its latest version', async () => {
      const docId = newObjectId();
      const versionId = newObjectId();
      const createdBy = newObjectId();
      const createdAt = new Date('2026-08-01T00:00:00Z');
      documents.findByFolder.mockResolvedValue([
        { _id: docId, folderId, name: 'report.pdf', status: 'indexed', latestVersionId: versionId, createdBy, createdAt },
      ]);
      documentVersions.findById.mockResolvedValue({ versionNumber: 2, sizeBytes: 12345 });

      const result = await controller.listByFolder(folderId.toString());

      expect(result).toEqual([
        {
          id: docId.toString(),
          folderId: folderId.toString(),
          name: 'report.pdf',
          status: 'indexed',
          latestVersionId: versionId.toString(),
          latestVersionNumber: 2,
          sizeBytes: 12345,
          createdBy: createdBy.toString(),
          createdAt,
        },
      ]);
    });

    it('checks readability using a lowercased folder id, tolerating an uppercase-hex URL param', async () => {
      await controller.listByFolder(folderId.toString().toUpperCase());

      expect(permissions.canRead).toHaveBeenCalledWith(folderId.toString());
      expect(documents.findByFolder).toHaveBeenCalledWith(folderId);
    });
  });
});
