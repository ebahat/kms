import { Types } from 'mongoose';
import { RecycleBinEntriesRepository } from './recycle-bin-entries.repository';
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
    modelName: 'RecycleBinEntry',
    find: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
  };
}

describe('RecycleBinEntriesRepository', () => {
  let cls: FakeCls;
  const tenantId = new Types.ObjectId();

  beforeEach(() => {
    cls = new FakeCls();
    const scope: Scope = { tenantId, userId: new Types.ObjectId(), role: 'user', edition: 'kb' };
    cls.set(SCOPE_CLS_KEY, scope);
  });

  it('findPending scopes by tenantId and status: pending', () => {
    const model = makeModel();
    const repo = new RecycleBinEntriesRepository(model as any, cls as any);
    repo.findPending();
    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId, status: 'pending' }));
  });

  it('createEntry stamps status: pending and stores the given fields', async () => {
    const model = makeModel();
    model.create.mockResolvedValue({ _id: new Types.ObjectId() });
    const documentId = new Types.ObjectId();
    const folderId = new Types.ObjectId();
    const deletedBy = new Types.ObjectId();
    const purgeAfter = new Date('2026-09-01T00:00:00Z');
    const repo = new RecycleBinEntriesRepository(model as any, cls as any);

    await repo.createEntry({ documentId, folderId, name: 'report.pdf', versions: [], deletedBy, purgeAfter });

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ documentId, folderId, name: 'report.pdf', deletedBy, purgeAfter, status: 'pending', tenantId }),
    );
  });

  it('markRestored sets status to restored', async () => {
    const model = makeModel();
    model.updateOne.mockResolvedValue({});
    const id = new Types.ObjectId();
    const repo = new RecycleBinEntriesRepository(model as any, cls as any);

    await repo.markRestored(id);

    expect(model.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: id, tenantId }), { $set: { status: 'restored' } });
  });

  it('markPurged sets status to purged', async () => {
    const model = makeModel();
    model.updateOne.mockResolvedValue({});
    const id = new Types.ObjectId();
    const repo = new RecycleBinEntriesRepository(model as any, cls as any);

    await repo.markPurged(id);

    expect(model.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: id, tenantId }), { $set: { status: 'purged' } });
  });
});
