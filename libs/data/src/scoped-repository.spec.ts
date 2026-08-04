import { Types } from 'mongoose';
import { ScopedRepository, OwnerScopedRepository } from './scoped-repository';
import { MissingScopeError } from './errors';
import { SCOPE_CLS_KEY, Scope } from './scope';

/** Minimal fake standing in for nestjs-cls's ClsService in these unit tests. */
class FakeCls {
  private store = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  set(key: string, value: unknown) {
    this.store.set(key, value);
  }
  clear() {
    this.store.clear();
  }
}

const fakeModel = {
  modelName: 'TestModel',
  find: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
  aggregate: jest.fn(),
  create: jest.fn(),
};

class TestRepository extends ScopedRepository<{ tenantId: Types.ObjectId }> {}
class TestOwnerRepository extends OwnerScopedRepository<{ tenantId: Types.ObjectId; ownerUserId: Types.ObjectId }> {}

describe('ScopedRepository (ADR-0001 — the crown jewels)', () => {
  let cls: FakeCls;

  beforeEach(() => {
    cls = new FakeCls();
    jest.clearAllMocks();
  });

  it('throws MissingScopeError when no scope is set in CLS (fail closed)', () => {
    const repo = new TestRepository(fakeModel as any, cls as any);
    expect(() => (repo as any).scope()).toThrow(MissingScopeError);
    expect(fakeModel.find).not.toHaveBeenCalled();
  });

  it('injects tenantId from CLS scope into find()', () => {
    const tenantId = new Types.ObjectId();
    const scope: Scope = { tenantId, userId: new Types.ObjectId(), role: 'user', edition: 'kb', featureToggles: [] };
    cls.set(SCOPE_CLS_KEY, scope);

    const repo = new TestRepository(fakeModel as any, cls as any);
    repo.find({});

    expect(fakeModel.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId }));
  });

  it('never lets a caller-supplied tenantId override the scoped one', () => {
    const realTenantId = new Types.ObjectId();
    const attackerTenantId = new Types.ObjectId();
    cls.set(SCOPE_CLS_KEY, { tenantId: realTenantId, userId: new Types.ObjectId(), role: 'user', edition: 'kb' });

    const repo = new TestRepository(fakeModel as any, cls as any);
    // scope() is spread AFTER the caller filter, so it always wins (scoped-repository.ts ordering).
    repo.find({ tenantId: attackerTenantId } as any);

    const calledWith = fakeModel.find.mock.calls[0][0];
    expect(calledWith.tenantId).toEqual(realTenantId);
  });

  it('prepends the scope as the FIRST aggregate pipeline stage', () => {
    const tenantId = new Types.ObjectId();
    cls.set(SCOPE_CLS_KEY, { tenantId, userId: new Types.ObjectId(), role: 'user', edition: 'kb' });

    const repo = new TestRepository(fakeModel as any, cls as any);
    repo.aggregate([{ $sort: { name: 1 } } as any]);

    const pipeline = fakeModel.aggregate.mock.calls[0][0];
    expect(pipeline[0]).toEqual({ $match: { tenantId } });
  });
});

describe('OwnerScopedRepository (Smart-OCR files + private chat history — sec §3.5/§3.6)', () => {
  let cls: FakeCls;

  beforeEach(() => {
    cls = new FakeCls();
    jest.clearAllMocks();
  });

  it('throws MissingScopeError if ownerUserId is absent, even with a valid tenantId', () => {
    cls.set(SCOPE_CLS_KEY, { tenantId: new Types.ObjectId(), userId: new Types.ObjectId(), role: 'user', edition: 'ocr' });

    const repo = new TestOwnerRepository(fakeModel as any, cls as any);
    expect(() => (repo as any).scope()).toThrow(MissingScopeError);
  });

  it('scopes by BOTH tenantId and ownerUserId — a tenant admin sharing tenantId cannot pass this filter', () => {
    const tenantId = new Types.ObjectId();
    const ownerUserId = new Types.ObjectId();
    cls.set(SCOPE_CLS_KEY, { tenantId, userId: ownerUserId, role: 'user', edition: 'ocr', ownerUserId });

    const repo = new TestOwnerRepository(fakeModel as any, cls as any);
    repo.find({});

    expect(fakeModel.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId, ownerUserId }));
  });
});
