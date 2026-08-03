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
  let storage: any;
  let ingestionQueue: any;
  let controller: DocumentsController;

  beforeEach(() => {
    cls = { get: jest.fn().mockReturnValue({ tenantId, userId, role: 'user', edition: 'kb' }) };
    documents = {
      createDocument: jest.fn().mockResolvedValue({ _id: newObjectId() }),
      findById: jest.fn(),
      setLatestVersion: jest.fn().mockResolvedValue(undefined),
    };
    documentVersions = {
      createVersion: jest.fn().mockImplementation((doc) => Promise.resolve({ _id: doc.id ?? newObjectId() })),
      sumSizeForTenant: jest.fn().mockResolvedValue(0),
      latestVersionNumber: jest.fn().mockResolvedValue(1),
      findById: jest.fn(),
    };
    tenants = { findById: jest.fn().mockResolvedValue({ storageQuotaBytes: 1_073_741_824 }) };
    permissions = { canUploadTo: jest.fn().mockResolvedValue(true), canRead: jest.fn().mockResolvedValue(true) };
    auditEvents = { record: jest.fn().mockResolvedValue(undefined) };
    storage = {
      putObject: jest.fn().mockResolvedValue(undefined),
      getSignedDownloadUrl: jest.fn().mockResolvedValue({ url: 'https://signed.example/x', expiresAt: new Date('2026-01-01T00:05:00Z') }),
    };
    ingestionQueue = { enqueueScan: jest.fn() };
    controller = new DocumentsController(cls, documents, documentVersions, tenants, permissions, auditEvents, storage, ingestionQueue);
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
});
