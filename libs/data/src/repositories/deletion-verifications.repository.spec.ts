import { Types } from 'mongoose';
import { DeletionVerificationsRepository } from './deletion-verifications.repository';
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
    modelName: 'DeletionVerification',
    find: jest.fn(),
    create: jest.fn(),
  };
}

describe('DeletionVerificationsRepository (sec §7.3 — deletion is verified, not assumed)', () => {
  let cls: FakeCls;
  const tenantId = new Types.ObjectId();

  beforeEach(() => {
    cls = new FakeCls();
    const scope: Scope = { tenantId, userId: new Types.ObjectId(), role: 'user', edition: 'kb' };
    cls.set(SCOPE_CLS_KEY, scope);
  });

  it('record() defaults notes to [] when omitted', async () => {
    const model = makeModel();
    model.create.mockResolvedValue({});
    const recycleBinEntryId = new Types.ObjectId();
    const repo = new DeletionVerificationsRepository(model as any, cls as any);

    await repo.record({ recycleBinEntryId, objectKeysChecked: ['k1'], objectKeysStillPresent: [], passed: true });

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ recycleBinEntryId, objectKeysChecked: ['k1'], objectKeysStillPresent: [], passed: true, notes: [], tenantId }),
    );
  });

  it('record() stores provided notes and a failed result when objects are still present', async () => {
    const model = makeModel();
    model.create.mockResolvedValue({});
    const recycleBinEntryId = new Types.ObjectId();
    const repo = new DeletionVerificationsRepository(model as any, cls as any);

    await repo.record({
      recycleBinEntryId,
      objectKeysChecked: ['k1', 'k2'],
      objectKeysStillPresent: ['k2'],
      passed: false,
      notes: ['chunk/search-index checks deferred to Phase 3/4'],
    });

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ objectKeysStillPresent: ['k2'], passed: false, notes: ['chunk/search-index checks deferred to Phase 3/4'] }),
    );
  });

  it('findByRecycleBinEntry scopes by tenantId and recycleBinEntryId', () => {
    const model = makeModel();
    const recycleBinEntryId = new Types.ObjectId();
    const repo = new DeletionVerificationsRepository(model as any, cls as any);

    repo.findByRecycleBinEntry(recycleBinEntryId);

    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId, recycleBinEntryId }));
  });
});
