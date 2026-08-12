import { Types } from 'mongoose';
import { GroupsRepository } from './groups.repository';
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
  return { modelName: 'Group', find: jest.fn(), findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn().mockResolvedValue({ acknowledged: true }) };
}

describe('GroupsRepository', () => {
  let cls: FakeCls;
  const tenantId = new Types.ObjectId();

  beforeEach(() => {
    cls = new FakeCls();
    const scope: Scope = { tenantId, userId: new Types.ObjectId(), role: 'admin', edition: 'kb', featureToggles: [] };
    cls.set(SCOPE_CLS_KEY, scope);
  });

  it('findAllForTenant scopes by tenantId only', () => {
    const model = makeModel();
    const repo = new GroupsRepository(model as any, cls as any);
    repo.findAllForTenant();
    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId }));
  });

  it('findForMember filters by memberUserIds in addition to tenant scope', () => {
    const model = makeModel();
    const userId = new Types.ObjectId();
    const repo = new GroupsRepository(model as any, cls as any);
    repo.findForMember(userId);
    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId, memberUserIds: userId }));
  });

  it('createGroup starts with no members', async () => {
    const model = makeModel();
    model.create.mockResolvedValue({ _id: new Types.ObjectId() });
    const repo = new GroupsRepository(model as any, cls as any);

    await repo.createGroup('Sales');

    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sales', memberUserIds: [], tenantId }));
  });

  it('addMembers uses $addToSet, not a whole-array $set', async () => {
    const model = makeModel();
    const id = new Types.ObjectId();
    const userIds = [new Types.ObjectId(), new Types.ObjectId()];
    model.findOne.mockResolvedValue({ _id: id, memberUserIds: userIds });
    const repo = new GroupsRepository(model as any, cls as any);

    await repo.addMembers(id, userIds);

    expect(model.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: id }), { $addToSet: { memberUserIds: { $each: userIds } } });
  });

  it('removeMembers uses $pull', async () => {
    const model = makeModel();
    const id = new Types.ObjectId();
    const userIds = [new Types.ObjectId()];
    model.findOne.mockResolvedValue({ _id: id, memberUserIds: [] });
    const repo = new GroupsRepository(model as any, cls as any);

    await repo.removeMembers(id, userIds);

    expect(model.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: id }), { $pull: { memberUserIds: { $in: userIds } } });
  });
});
