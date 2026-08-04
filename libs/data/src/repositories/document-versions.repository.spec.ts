import { Types } from 'mongoose';
import { DocumentVersionsRepository } from './document-versions.repository';
import { SCOPE_CLS_KEY, Scope } from '../scope';

class FakeCls {
  private store = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  set(key: string, value: unknown) {
    this.store.set(key, value);
  }
}

function makeModel() {
  return {
    modelName: 'DocumentVersion',
    find: jest.fn(),
    create: jest.fn(),
    aggregate: jest.fn(),
  };
}

function makeSortableFindResult(resolved: unknown[]) {
  return { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue(resolved) };
}

describe('DocumentVersionsRepository', () => {
  let cls: FakeCls;
  const tenantId = new Types.ObjectId();

  beforeEach(() => {
    cls = new FakeCls();
    const scope: Scope = { tenantId, userId: new Types.ObjectId(), role: 'user', edition: 'kb', featureToggles: [] };
    cls.set(SCOPE_CLS_KEY, scope);
  });

  it('findByDocument scopes by tenantId and documentId', () => {
    const model = makeModel();
    model.find.mockReturnValue([]);
    const documentId = new Types.ObjectId();
    const repo = new DocumentVersionsRepository(model as any, cls as any);
    repo.findByDocument(documentId);
    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId, documentId }));
  });

  it('latestVersionNumber returns 0 when the document has no versions yet', async () => {
    const model = makeModel();
    model.find.mockReturnValue(makeSortableFindResult([]));
    const repo = new DocumentVersionsRepository(model as any, cls as any);

    expect(await repo.latestVersionNumber(new Types.ObjectId())).toBe(0);
  });

  it('latestVersionNumber returns the highest versionNumber found', async () => {
    const model = makeModel();
    model.find.mockReturnValue(makeSortableFindResult([{ versionNumber: 3 }]));
    const repo = new DocumentVersionsRepository(model as any, cls as any);

    expect(await repo.latestVersionNumber(new Types.ObjectId())).toBe(3);
  });

  it('createVersion stores all provided fields scoped to the tenant', async () => {
    const model = makeModel();
    model.create.mockResolvedValue({ _id: new Types.ObjectId() });
    const documentId = new Types.ObjectId();
    const uploadedBy = new Types.ObjectId();
    const repo = new DocumentVersionsRepository(model as any, cls as any);

    await repo.createVersion({
      documentId,
      versionNumber: 1,
      storageKey: 'tenants/x/versions/y',
      originalFilename: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      contentHashSha256: 'abc123',
      uploadedBy,
    });

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ documentId, versionNumber: 1, sizeBytes: 1024, uploadedBy, tenantId }),
    );
    expect(model.create).toHaveBeenCalledWith(expect.not.objectContaining({ _id: expect.anything() }));
  });

  it('createVersion uses the caller-provided id when given (storage-key-before-write ordering)', async () => {
    const model = makeModel();
    model.create.mockResolvedValue({});
    const preGeneratedId = new Types.ObjectId();
    const repo = new DocumentVersionsRepository(model as any, cls as any);

    await repo.createVersion({
      id: preGeneratedId,
      documentId: new Types.ObjectId(),
      versionNumber: 1,
      storageKey: 'tenants/x/versions/y',
      originalFilename: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      contentHashSha256: 'abc123',
      uploadedBy: new Types.ObjectId(),
    });

    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ _id: preGeneratedId }));
  });

  it('sumSizeForTenant returns 0 when the tenant has no versions', async () => {
    const model = makeModel();
    model.aggregate.mockResolvedValue([]);
    const repo = new DocumentVersionsRepository(model as any, cls as any);

    expect(await repo.sumSizeForTenant()).toBe(0);
  });

  it('sumSizeForTenant returns the summed size, scoped to the tenant via the mandatory $match-first stage', async () => {
    const model = makeModel();
    model.aggregate.mockResolvedValue([{ total: 52_428_800 }]);
    const repo = new DocumentVersionsRepository(model as any, cls as any);

    expect(await repo.sumSizeForTenant()).toBe(52_428_800);
    expect(model.aggregate).toHaveBeenCalledWith([
      { $match: { tenantId } },
      { $group: { _id: null, total: { $sum: '$sizeBytes' } } },
    ]);
  });
});
