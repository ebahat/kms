import { Types } from 'mongoose';
import { FoldersRepository } from './folders.repository';
import { FolderCycleError, FolderDepthExceededError, FolderLimitExceededError, FolderParentNotFoundError } from '../errors';
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
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  };
}

/** findOne, keyed by _id, so moveFolder's several sequential findById calls each get the right fixture. */
function byIdMock(model: ReturnType<typeof makeModel>, docs: Array<{ _id: Types.ObjectId }>) {
  model.findOne.mockImplementation((query: any) => {
    const doc = docs.find((d) => d._id.equals(query._id));
    return Promise.resolve(doc ?? null);
  });
}

describe('FoldersRepository', () => {
  let cls: FakeCls;
  const tenantId = new Types.ObjectId();

  beforeEach(() => {
    cls = new FakeCls();
    const scope: Scope = { tenantId, userId: new Types.ObjectId(), role: 'admin', edition: 'kb', featureToggles: [] };
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

  it('createFolder rejects a parentId that does not resolve in the tenant, without ever inserting', async () => {
    // findById is tenant-scoped (ScopedRepository) — a null result here covers both "parentId doesn't
    // exist at all" and "parentId belongs to another tenant" identically, since the scoped query
    // can't distinguish them and shouldn't (Phase 2 plan Task 1 — a dangling parentId must never be
    // stored, it breaks ADR-0005's resolver for the whole tenant, not just this folder).
    const model = makeModel();
    model.countDocuments.mockResolvedValue(0);
    model.findOne.mockResolvedValue(null);

    const repo = new FoldersRepository(model as any, cls as any);
    await expect(repo.createFolder({ name: 'x', parentId: new Types.ObjectId() })).rejects.toThrow(FolderParentNotFoundError);
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

  describe('renameFolder', () => {
    it('sets the name and returns the updated folder', async () => {
      const model = makeModel();
      const id = new Types.ObjectId();
      model.findOne.mockResolvedValue({ _id: id, name: 'New name' });

      const repo = new FoldersRepository(model as any, cls as any);
      const result = await repo.renameFolder(id, 'New name');

      expect(model.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: id }), { $set: { name: 'New name' } });
      expect(result?.name).toBe('New name');
    });
  });

  describe('moveFolder (Phase 2 plan Task 4 — "the hard part")', () => {
    it('rejects moving a folder into itself', async () => {
      const model = makeModel();
      const id = new Types.ObjectId();
      byIdMock(model, [{ _id: id, path: [] } as any]);

      const repo = new FoldersRepository(model as any, cls as any);
      await expect(repo.moveFolder(id, id)).rejects.toThrow(FolderCycleError);
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('rejects moving a folder into one of its own descendants', async () => {
      const model = makeModel();
      const root = { _id: new Types.ObjectId(), path: [] };
      const child = { _id: new Types.ObjectId(), path: [root._id] };
      byIdMock(model, [root, child] as any);

      const repo = new FoldersRepository(model as any, cls as any);
      await expect(repo.moveFolder(root._id, child._id)).rejects.toThrow(FolderCycleError);
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('rejects a destination that does not resolve in the tenant', async () => {
      const model = makeModel();
      const id = new Types.ObjectId();
      byIdMock(model, [{ _id: id, path: [] } as any]);

      const repo = new FoldersRepository(model as any, cls as any);
      await expect(repo.moveFolder(id, new Types.ObjectId())).rejects.toThrow(FolderParentNotFoundError);
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('rejects when the moved subtree would exceed MAX_FOLDER_DEPTH, even though the folder itself would not', async () => {
      // A shallow folder can still bust the bound via a deep descendant — the check must look at
      // the whole subtree's max path length, not just the folder being moved.
      const model = makeModel();
      const shallowFolder = { _id: new Types.ObjectId(), path: [] };
      const deepPath = Array.from({ length: MAX_FOLDER_DEPTH - 1 }, () => new Types.ObjectId());
      const deepDescendant = { _id: new Types.ObjectId(), path: [...deepPath, shallowFolder._id] };
      const destination = { _id: new Types.ObjectId(), path: Array.from({ length: MAX_FOLDER_DEPTH - 2 }, () => new Types.ObjectId()) };
      byIdMock(model, [shallowFolder, destination] as any);
      model.find.mockResolvedValue([deepDescendant]);

      const repo = new FoldersRepository(model as any, cls as any);
      await expect(repo.moveFolder(shallowFolder._id, destination._id)).rejects.toThrow(FolderDepthExceededError);
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('rewrites the path of every descendant across a 3-level subtree when the moved folder changes ancestors', async () => {
      const root = { _id: new Types.ObjectId(), path: [] };
      const mid = { _id: new Types.ObjectId(), path: [root._id] };
      const moved = { _id: new Types.ObjectId(), path: [root._id, mid._id] };
      const childA = { _id: new Types.ObjectId(), path: [root._id, mid._id, moved._id] };
      const grandchildA = { _id: new Types.ObjectId(), path: [root._id, mid._id, moved._id, childA._id] };
      const newParent = { _id: new Types.ObjectId(), path: [] };

      const model = makeModel();
      byIdMock(model, [root, mid, moved, childA, grandchildA, newParent] as any);
      model.find.mockResolvedValue([childA, grandchildA]);

      const repo = new FoldersRepository(model as any, cls as any);
      await repo.moveFolder(moved._id, newParent._id);

      expect(model.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: moved._id }), { $set: { parentId: newParent._id, path: [newParent._id] } });
      expect(model.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: childA._id }), { $set: { path: [newParent._id, moved._id] } });
      expect(model.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: grandchildA._id }), {
        $set: { path: [newParent._id, moved._id, childA._id] },
      });
    });

    it('moving to root (null) clears path entirely', async () => {
      const model = makeModel();
      const id = new Types.ObjectId();
      byIdMock(model, [{ _id: id, path: [new Types.ObjectId(), new Types.ObjectId()] }] as any);
      model.find.mockResolvedValue([]);

      const repo = new FoldersRepository(model as any, cls as any);
      await repo.moveFolder(id, null);

      expect(model.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: id }), { $set: { parentId: null, path: [] } });
    });
  });
});
