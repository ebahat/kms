import { BadRequestException } from '@nestjs/common';
import { newObjectId } from '@kms/data';
import { NotificationPreferencesController } from './notification-preferences.controller';

const ALL_OFF = {
  fileAdded: 'off',
  fileDeleted: 'off',
  taskAdded: 'off',
  taskDeleted: 'off',
  taskStatusChanged: 'off',
};

/** Stateful fake so create-on-first-read and "other fields unchanged" are observable, not just asserted mock calls. */
function makeFakePreferences() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    findOrCreateForUser: jest.fn(async (userId: { toString(): string }) => {
      const key = userId.toString();
      if (!rows.has(key)) rows.set(key, { _id: newObjectId(), userId, ...ALL_OFF });
      return { ...rows.get(key) };
    }),
    updateForUser: jest.fn(async (userId: { toString(): string }, patch: Record<string, unknown>) => {
      const row = rows.get(userId.toString());
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    }),
  };
}

describe('NotificationPreferencesController (Phase 2A, no @Module gate — core notifications are not opt-in)', () => {
  const tenantId = newObjectId();
  const userId = newObjectId();

  let cls: any;
  let preferences: ReturnType<typeof makeFakePreferences>;
  let controller: NotificationPreferencesController;

  beforeEach(() => {
    cls = { get: jest.fn().mockReturnValue({ tenantId, userId, role: 'user', edition: 'kb', featureToggles: [] }) };
    preferences = makeFakePreferences();
    controller = new NotificationPreferencesController(cls, preferences as any);
  });

  describe('get', () => {
    it('creates the row on first read with every field off, and returns it', async () => {
      expect(preferences.rows.size).toBe(0);

      const result = await controller.get();

      expect(preferences.findOrCreateForUser).toHaveBeenCalledWith(userId);
      expect(result).toMatchObject(ALL_OFF);
      expect(preferences.rows.size).toBe(1);
    });

    it('returns the same row on a second read rather than creating another', async () => {
      const first = await controller.get();
      const second = await controller.get();

      expect(second._id).toEqual(first._id);
      expect(preferences.rows.size).toBe(1);
    });
  });

  describe('update', () => {
    it('updates only the given field and leaves the others untouched on re-fetch', async () => {
      await controller.update({ fileAdded: 'all' });

      const refetched = await controller.get();
      expect(refetched).toMatchObject({
        fileAdded: 'all',
        fileDeleted: 'off',
        taskAdded: 'off',
        taskDeleted: 'off',
        taskStatusChanged: 'off',
      });
    });

    it('updates several fields at once and returns the updated document', async () => {
      const result = await controller.update({ taskAdded: 'mine', taskStatusChanged: 'all' });

      expect(result).toMatchObject({ taskAdded: 'mine', taskStatusChanged: 'all', fileAdded: 'off' });
      expect(preferences.updateForUser).toHaveBeenCalledWith(userId, { taskAdded: 'mine', taskStatusChanged: 'all' });
    });

    it('creates the row first when patching before any read', async () => {
      await controller.update({ fileDeleted: 'mine' });

      expect(preferences.findOrCreateForUser).toHaveBeenCalledWith(userId);
      expect(preferences.rows.size).toBe(1);
    });

    // tenantId/userId are real schema paths, so mongoose strict mode would NOT strip them
    // from a raw $set — a client could otherwise reassign its row to another tenant.
    it.each(['tenantId', 'userId', '_id'])('rejects the protected field %s and writes nothing', async (field) => {
      await expect(controller.update({ [field]: newObjectId().toString() } as any)).rejects.toThrow(BadRequestException);
      expect(preferences.updateForUser).not.toHaveBeenCalled();
    });

    it('rejects an unknown field and writes nothing', async () => {
      await expect(controller.update({ somethingElse: 'all' } as any)).rejects.toThrow(BadRequestException);
      expect(preferences.updateForUser).not.toHaveBeenCalled();
    });

    it('rejects a value outside off/mine/all and writes nothing', async () => {
      await expect(controller.update({ fileAdded: 'everything' } as any)).rejects.toThrow(BadRequestException);
      expect(preferences.updateForUser).not.toHaveBeenCalled();
    });

    it('rejects an empty patch rather than issuing an empty $set', async () => {
      await expect(controller.update({})).rejects.toThrow(BadRequestException);
      expect(preferences.updateForUser).not.toHaveBeenCalled();
    });
  });
});
