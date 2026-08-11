import { Types } from 'mongoose';
import { UserNotificationPreferencesRepository } from './user-notification-preferences.repository';
import { SCOPE_CLS_KEY, Scope } from '../scope';
import { MissingScopeError } from '../errors';

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
  return { modelName: 'UserNotificationPreference', find: jest.fn(), create: jest.fn(), findOneAndUpdate: jest.fn() };
}

describe('UserNotificationPreferencesRepository', () => {
  let cls: FakeCls;
  const tenantId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  beforeEach(() => {
    cls = new FakeCls();
    const scope: Scope = { tenantId, userId, role: 'user', edition: 'kb', featureToggles: [] };
    cls.set(SCOPE_CLS_KEY, scope);
  });

  describe('findOrCreateForUser', () => {
    it('upserts scoped by tenantId and userId, seeding every field to off', () => {
      const model = makeModel();
      const repo = new UserNotificationPreferencesRepository(model as any, cls as any);

      repo.findOrCreateForUser(userId);

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId, userId }),
        {
          $setOnInsert: {
            fileAdded: 'off',
            fileDeleted: 'off',
            taskAdded: 'off',
            taskDeleted: 'off',
            taskStatusChanged: 'off',
          },
        },
        expect.objectContaining({ upsert: true, new: true }),
      );
    });

    // Idempotency is what makes create-on-first-read safe: two concurrent first reads
    // must not both insert and trip the {tenantId,userId} unique index.
    it('is idempotent — a single atomic upsert, never a read-then-create race', () => {
      const model = makeModel();
      const repo = new UserNotificationPreferencesRepository(model as any, cls as any);

      repo.findOrCreateForUser(userId);

      expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(model.find).not.toHaveBeenCalled();
      expect(model.create).not.toHaveBeenCalled();
    });

    it('fails closed when there is no authenticated scope', () => {
      const model = makeModel();
      const repo = new UserNotificationPreferencesRepository(model as any, new FakeCls() as any);

      expect(() => repo.findOrCreateForUser(userId)).toThrow(MissingScopeError);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('updateForUser', () => {
    it('scopes by tenantId and userId and sets only the patched fields', () => {
      const model = makeModel();
      const repo = new UserNotificationPreferencesRepository(model as any, cls as any);

      repo.updateForUser(userId, { fileAdded: 'all' });

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId, userId }),
        { $set: { fileAdded: 'all' } },
        expect.objectContaining({ new: true }),
      );
    });

    it('never upserts — the row is guaranteed to exist by findOrCreateForUser', () => {
      const model = makeModel();
      const repo = new UserNotificationPreferencesRepository(model as any, cls as any);

      repo.updateForUser(userId, { taskAdded: 'mine' });

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.not.objectContaining({ upsert: true }),
      );
    });

    it('fails closed when there is no authenticated scope', () => {
      const model = makeModel();
      const repo = new UserNotificationPreferencesRepository(model as any, new FakeCls() as any);

      expect(() => repo.updateForUser(userId, { fileAdded: 'all' })).toThrow(MissingScopeError);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('findAllWithPreference', () => {
    it('scopes by tenantId and matches the requested field value', () => {
      const model = makeModel();
      const repo = new UserNotificationPreferencesRepository(model as any, cls as any);

      repo.findAllWithPreference('taskStatusChanged', 'all');

      expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId, taskStatusChanged: 'all' }));
    });

    it('fails closed when there is no authenticated scope', () => {
      const model = makeModel();
      const repo = new UserNotificationPreferencesRepository(model as any, new FakeCls() as any);

      expect(() => repo.findAllWithPreference('fileAdded', 'mine')).toThrow(MissingScopeError);
      expect(model.find).not.toHaveBeenCalled();
    });
  });
});
