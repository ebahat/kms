import { Types } from 'mongoose';
import { EventsRepository } from './events.repository';
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
  return { modelName: 'Event', find: jest.fn(), create: jest.fn() };
}

describe('EventsRepository', () => {
  let cls: FakeCls;
  const tenantId = new Types.ObjectId();

  beforeEach(() => {
    cls = new FakeCls();
    const scope: Scope = { tenantId, userId: new Types.ObjectId(), role: 'admin', edition: 'kb', featureToggles: [] };
    cls.set(SCOPE_CLS_KEY, scope);
  });

  it('findForGroup scopes by tenantId and groupId', () => {
    const model = makeModel();
    const groupId = new Types.ObjectId();
    const repo = new EventsRepository(model as any, cls as any);
    repo.findForGroup(groupId);
    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId, groupId }));
  });

  it('findForGroupInRange scopes by tenantId, groupId, and overlapping range', () => {
    const model = makeModel();
    const groupId = new Types.ObjectId();
    const from = new Date('2026-01-01');
    const to = new Date('2026-01-31');
    const repo = new EventsRepository(model as any, cls as any);
    repo.findForGroupInRange(groupId, from, to);
    expect(model.find).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, groupId, startAt: { $lte: to }, endAt: { $gte: from } }),
    );
  });
});
