import { Types } from 'mongoose';
import { DocumentsRepository } from './documents.repository';
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
    modelName: 'Document',
    find: jest.fn(),
    findOne: jest.fn(),
    countDocuments: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
  };
}

describe('DocumentsRepository', () => {
  let cls: FakeCls;
  const tenantId = new Types.ObjectId();

  beforeEach(() => {
    cls = new FakeCls();
    const scope: Scope = { tenantId, userId: new Types.ObjectId(), role: 'user', edition: 'kb', featureToggles: [] };
    cls.set(SCOPE_CLS_KEY, scope);
  });

  it('findByFolder scopes by tenantId and folderId', () => {
    const model = makeModel();
    const folderId = new Types.ObjectId();
    const repo = new DocumentsRepository(model as any, cls as any);
    repo.findByFolder(folderId);
    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId, folderId }));
  });

  it('createDocument stamps status: queued and stores the given fields', async () => {
    const model = makeModel();
    model.create.mockResolvedValue({ _id: new Types.ObjectId() });
    const folderId = new Types.ObjectId();
    const latestVersionId = new Types.ObjectId();
    const createdBy = new Types.ObjectId();
    const repo = new DocumentsRepository(model as any, cls as any);

    await repo.createDocument({ folderId, name: 'Report.pdf', latestVersionId, createdBy });

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ folderId, name: 'Report.pdf', latestVersionId, createdBy, status: 'queued', tenantId }),
    );
  });

  it('createDocument uses the caller-provided id when given (cross-references a pre-generated version id)', async () => {
    const model = makeModel();
    model.create.mockResolvedValue({});
    const preGeneratedId = new Types.ObjectId();
    const repo = new DocumentsRepository(model as any, cls as any);

    await repo.createDocument({
      id: preGeneratedId,
      folderId: new Types.ObjectId(),
      name: 'Report.pdf',
      latestVersionId: new Types.ObjectId(),
      createdBy: new Types.ObjectId(),
    });

    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ _id: preGeneratedId }));
  });

  it('setLatestVersion updates the pointer and resets status to queued', async () => {
    const model = makeModel();
    model.updateOne.mockResolvedValue({});
    const id = new Types.ObjectId();
    const versionId = new Types.ObjectId();
    const repo = new DocumentsRepository(model as any, cls as any);

    await repo.setLatestVersion(id, versionId);

    expect(model.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: id, tenantId }),
      { $set: { latestVersionId: versionId, status: 'queued' } },
    );
  });

  it('setStatus updates only the status field', async () => {
    const model = makeModel();
    model.updateOne.mockResolvedValue({});
    const id = new Types.ObjectId();
    const repo = new DocumentsRepository(model as any, cls as any);

    await repo.setStatus(id, 'failed');

    expect(model.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: id, tenantId }), { $set: { status: 'failed' } });
  });

  it('renameDocument updates the name field and returns the refreshed document', async () => {
    const model = makeModel();
    model.updateOne.mockResolvedValue({});
    const id = new Types.ObjectId();
    model.findOne.mockResolvedValue({ _id: id, name: 'New Name.pdf' });
    const repo = new DocumentsRepository(model as any, cls as any);

    const result = await repo.renameDocument(id, 'New Name.pdf');

    expect(model.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: id, tenantId }), { $set: { name: 'New Name.pdf' } });
    expect(result).toEqual(expect.objectContaining({ name: 'New Name.pdf' }));
  });

  it('moveDocument updates the folderId field and returns the refreshed document', async () => {
    const model = makeModel();
    model.updateOne.mockResolvedValue({});
    const id = new Types.ObjectId();
    const newFolderId = new Types.ObjectId();
    model.findOne.mockResolvedValue({ _id: id, folderId: newFolderId });
    const repo = new DocumentsRepository(model as any, cls as any);

    const result = await repo.moveDocument(id, newFolderId);

    expect(model.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: id, tenantId }), { $set: { folderId: newFolderId } });
    expect(result).toEqual(expect.objectContaining({ folderId: newFolderId }));
  });

  it('touchLastOpened sets lastOpenedAt to a fresh Date', async () => {
    const model = makeModel();
    model.updateOne.mockResolvedValue({});
    const id = new Types.ObjectId();
    const repo = new DocumentsRepository(model as any, cls as any);

    await repo.touchLastOpened(id);

    expect(model.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: id, tenantId }), { $set: { lastOpenedAt: expect.any(Date) } });
  });
});
