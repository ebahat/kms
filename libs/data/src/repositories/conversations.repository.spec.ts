import { Types } from 'mongoose';
import { ConversationsRepository } from './conversations.repository';
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
    modelName: 'Conversation',
    find: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
  };
}

describe('ConversationsRepository (owner-scoped — sec §3.5)', () => {
  let cls: FakeCls;
  const tenantId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  beforeEach(() => {
    cls = new FakeCls();
    const scope: Scope = { tenantId, userId, role: 'user', edition: 'kb', featureToggles: [], ownerUserId: userId };
    cls.set(SCOPE_CLS_KEY, scope);
  });

  it('createConversation stamps both tenantId and ownerUserId', async () => {
    const model = makeModel();
    model.create.mockResolvedValue({ _id: new Types.ObjectId() });
    const repo = new ConversationsRepository(model as any, cls as any);

    await repo.createConversation();

    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId, ownerUserId: userId }));
  });

  it('listByOwner queries scoped by tenant+owner and sorts newest-first', () => {
    const model = makeModel();
    const sortFn = jest.fn().mockResolvedValue([]);
    model.find.mockReturnValue({ sort: sortFn });
    const repo = new ConversationsRepository(model as any, cls as any);

    repo.listByOwner();

    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId, ownerUserId: userId }));
    expect(sortFn).toHaveBeenCalledWith({ updatedAt: -1 });
  });

  it('touchUpdatedAt bumps updatedAt, scoped by tenant+owner', async () => {
    const model = makeModel();
    model.updateOne.mockResolvedValue({});
    const id = new Types.ObjectId();
    const repo = new ConversationsRepository(model as any, cls as any);

    await repo.touchUpdatedAt(id);

    expect(model.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: id, tenantId, ownerUserId: userId }),
      { $set: { updatedAt: expect.any(Date) } },
    );
  });

  it('deleteConversation is a real delete, scoped by tenant+owner — a caller cannot delete another user\'s conversation even in the same tenant', async () => {
    const model = makeModel();
    model.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const id = new Types.ObjectId();
    const repo = new ConversationsRepository(model as any, cls as any);

    await repo.deleteConversation(id);

    expect(model.deleteOne).toHaveBeenCalledWith(expect.objectContaining({ _id: id, tenantId, ownerUserId: userId }));
  });

  it('throws when no ownerUserId is present in scope (fail-closed — MissingScopeError)', () => {
    const scopelessCls = new FakeCls();
    scopelessCls.set(SCOPE_CLS_KEY, { tenantId, userId, role: 'user', edition: 'kb', featureToggles: [] } as Scope);
    const model = makeModel();
    const repo = new ConversationsRepository(model as any, scopelessCls as any);

    expect(() => repo.listByOwner()).toThrow();
  });
});
