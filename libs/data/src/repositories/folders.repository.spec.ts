import { Types } from 'mongoose';
import { FoldersRepository } from './folders.repository';
import { FolderDepthExceededError, FolderLimitExceededError } from '../errors';
import { SCOPE_CLS_KEY, Scope } from '../scope';
import { MAX_FOLDER_DEPTH, MAX_FOLDERS_PER_TENANT } from '../models/folder.schema';

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
    modelName: 'Folder',
    find: jest.fn(),
    findOne: jest.fn(),
    countDocuments: jest.fn(),
    create: jest.fn(),
  };
}

describe('FoldersRepository', () => {
  let cls: FakeCls;
  const tenantId = new Types.ObjectId();

  beforeEach(() => {
    cls = new FakeCls();
    const scope: Scope = { tenantId, userId: new Types.ObjectId(), role: 'admin', edition: 'kb' };
    cls.set(SCOPE_CLS_KEY, scope);
  });

  it('findAllForTenant scopes by tenantId only', () => {
    const model = makeModel();
    const repo = new FoldersRepository(model as any, cls as any);
    repo.findAllForTenant();
    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId }));
  });

  it('findChildren filters by parentId in addition to tenant scope', () => {
    const model = makeModel();
    const parentId = new Types.ObjectId();
    const repo = new FoldersRepository(model as any, cls as any);
    repo.findChildren(parentId);
    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId, parentId }));
  });

  it('createFolder rejects once the tenant is at the folder-count limit', async () => {
    const model = makeModel();
    model.countDocuments.mockResolvedValue(MAX_FOLDERS_PER_TENANT);
    const repo = new FoldersRepository(model as any, cls as any);

    await expect(repo.createFolder({ name: 'x', parentId: null })).rejects.toThrow(FolderLimitExceededError);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('createFolder computes path as parent.path + parentId', async () => {
    const model = makeModel();
    model.countDocuments.mockResolvedValue(0);
    const parentId = new Types.ObjectId();
    const grandparentId = new Types.ObjectId();
    model.findOne.mockResolvedValue({ _id: parentId, path: [grandparentId] });
    model.create.mockResolvedValue({ _id: new Types.ObjectId() });

    const repo = new FoldersRepository(model as any, cls as any);
    await repo.createFolder({ name: 'child', parentId });

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ path: [grandparentId, parentId], parentId, name: 'child' }),
    );
  });

  it('createFolder rejects once nesting would exceed MAX_FOLDER_DEPTH', async () => {
    const model = makeModel();
    model.countDocuments.mockResolvedValue(0);
    const parentId = new Types.ObjectId();
    const deepPath = Array.from({ length: MAX_FOLDER_DEPTH }, () => new Types.ObjectId());
    model.findOne.mockResolvedValue({ _id: parentId, path: deepPath });

    const repo = new FoldersRepository(model as any, cls as any);
    await expect(repo.createFolder({ name: 'toodeep', parentId })).rejects.toThrow(FolderDepthExceededError);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('createFolder on a root folder (no parentId) gets an empty path', async () => {
    const model = makeModel();
    model.countDocuments.mockResolvedValue(0);
    model.create.mockResolvedValue({ _id: new Types.ObjectId() });

    const repo = new FoldersRepository(model as any, cls as any);
    await repo.createFolder({ name: 'root', parentId: null });

    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ path: [], parentId: null }));
    expect(model.findOne).not.toHaveBeenCalled();
  });
});
