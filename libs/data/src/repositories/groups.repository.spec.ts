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

  it('findForMember filters by members.userId in addition to tenant scope', () => {
    const model = makeModel();
    const userId = new Types.ObjectId();
    const repo = new GroupsRepository(model as any, cls as any);
    repo.findForMember(userId);
    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId, 'members.userId': userId }));
  });

  it('createGroup starts with no members', async () => {
    const model = makeModel();
    model.create.mockResolvedValue({ _id: new Types.ObjectId() });
    const repo = new GroupsRepository(model as any, cls as any);

    await repo.createGroup('Sales');

    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sales', members: [], tenantId }));
  });

  it('setMember pulls then pushes — never a whole-array $set — so a role change cannot leave a duplicate row', async () => {
    const model = makeModel();
    const id = new Types.ObjectId();
    const userId = new Types.ObjectId();
    model.findOne.mockResolvedValue({ _id: id, members: [{ userId, role: 'editor' }] });
    const repo = new GroupsRepository(model as any, cls as any);

    await repo.setMember(id, userId, 'editor');

    expect(model.updateOne).toHaveBeenNthCalledWith(1, expect.objectContaining({ _id: id }), { $pull: { members: { userId } } });
    expect(model.updateOne).toHaveBeenNthCalledWith(2, expect.objectContaining({ _id: id }), { $push: { members: { userId, role: 'editor' } } });
  });

  it('removeMembers uses $pull on members.userId', async () => {
    const model = makeModel();
    const id = new Types.ObjectId();
    const userIds = [new Types.ObjectId()];
    model.findOne.mockResolvedValue({ _id: id, members: [] });
    const repo = new GroupsRepository(model as any, cls as any);

    await repo.removeMembers(id, userIds);

    expect(model.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: id }), { $pull: { members: { userId: { $in: userIds } } } });
  });

  it('findOneByName scopes by tenantId in addition to name', () => {
    const model = makeModel();
    const collation = jest.fn().mockReturnValue('the-query');
    model.findOne.mockReturnValue({ collation });
    const repo = new GroupsRepository(model as any, cls as any);
    repo.findOneByName('Sales');
    expect(model.findOne).toHaveBeenCalledWith(expect.objectContaining({ tenantId, name: 'Sales' }));
  });

  /** 2026-08-29 fix — "Sales" and "sales" were previously treated as distinct group names. */
  it('findOneByName matches case-insensitively via a MongoDB collation, not by lowercasing the query itself', () => {
    const model = makeModel();
    const collation = jest.fn().mockReturnValue('the-query');
    model.findOne.mockReturnValue({ collation });
    const repo = new GroupsRepository(model as any, cls as any);

    repo.findOneByName('Sales');

    expect(model.findOne).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sales' }));
    expect(collation).toHaveBeenCalledWith({ locale: 'en', strength: 2 });
  });

  it('rename updates the name field and returns the refreshed document', async () => {
    const model = makeModel();
    const id = new Types.ObjectId();
    model.findOne.mockResolvedValue({ _id: id, name: 'New Name' });
    const repo = new GroupsRepository(model as any, cls as any);

    const result = await repo.rename(id, 'New Name');

    expect(model.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: id }), { $set: { name: 'New Name' } });
    expect(result).toEqual(expect.objectContaining({ name: 'New Name' }));
  });
});
