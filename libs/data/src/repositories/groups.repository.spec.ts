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
  return { modelName: 'Group', find: jest.fn(), create: jest.fn() };
}

describe('GroupsRepository', () => {
  let cls: FakeCls;
  const tenantId = new Types.ObjectId();

  beforeEach(() => {
    cls = new FakeCls();
    const scope: Scope = { tenantId, userId: new Types.ObjectId(), role: 'admin', edition: 'kb' };
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
});
