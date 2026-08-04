import { Types } from 'mongoose';
import { AuditEventsRepository } from './audit-events.repository';
import { MissingScopeError } from '../errors';
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
    modelName: 'AuditEvent',
    find: jest.fn(),
    create: jest.fn(),
  };
}

describe('AuditEventsRepository (append-only, ADR-0002 sec §8.1)', () => {
  let cls: FakeCls;
  const tenantId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  beforeEach(() => {
    cls = new FakeCls();
    const scope: Scope = { tenantId, userId, role: 'user', edition: 'kb', featureToggles: [] };
    cls.set(SCOPE_CLS_KEY, scope);
  });

  it('record() stamps actorUserId from the current scope, never from caller input', async () => {
    const model = makeModel();
    model.create.mockResolvedValue({ _id: new Types.ObjectId() });
    const targetId = new Types.ObjectId();
    const repo = new AuditEventsRepository(model as any, cls as any);

    await repo.record({ action: 'document.download', targetId, metadata: { versionId: '1' } });

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, actorUserId: userId, action: 'document.download', targetId, metadata: { versionId: '1' } }),
    );
  });

  it('record() defaults targetId to null and metadata to {} when omitted', async () => {
    const model = makeModel();
    model.create.mockResolvedValue({});
    const repo = new AuditEventsRepository(model as any, cls as any);

    await repo.record({ action: 'document.download' });

    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ targetId: null, metadata: {} }));
  });

  it('record() throws MissingScopeError with no authenticated scope, rather than silently recording an unattributed event', async () => {
    const model = makeModel();
    const repo = new AuditEventsRepository(model as any, new FakeCls() as any);

    await expect(repo.record({ action: 'document.download' })).rejects.toThrow(MissingScopeError);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('findByTarget scopes by tenantId and targetId', () => {
    const model = makeModel();
    const targetId = new Types.ObjectId();
    const repo = new AuditEventsRepository(model as any, cls as any);

    repo.findByTarget(targetId);

    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId, targetId }));
  });
});
