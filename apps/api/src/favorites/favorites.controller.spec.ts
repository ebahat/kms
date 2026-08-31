import { NotFoundException } from '@nestjs/common';
import { newObjectId } from '@kms/data';
import { FavoritesController } from './favorites.controller';

describe('FavoritesController', () => {
  let favorites: any;
  let documents: any;
  let folders: any;
  let permissions: any;
  let auditEvents: any;
  let controller: FavoritesController;

  beforeEach(() => {
    favorites = { findOne: jest.fn(), addFavorite: jest.fn(), removeFavorite: jest.fn().mockResolvedValue(undefined), listForOwner: jest.fn() };
    documents = { findById: jest.fn() };
    folders = { findById: jest.fn() };
    permissions = { canRead: jest.fn(), permittedReadFolderIds: jest.fn().mockResolvedValue([]) };
    auditEvents = { record: jest.fn().mockResolvedValue(undefined) };

    controller = new FavoritesController(favorites, documents, folders, permissions, auditEvents);
  });

  describe('add', () => {
    it('adds a new folder favorite, checks read access, audits it', async () => {
      const folderId = newObjectId();
      folders.findById.mockResolvedValue({ _id: folderId, name: 'Sales' });
      permissions.canRead.mockResolvedValue(true);
      favorites.findOne.mockResolvedValue(null);
      const now = new Date();
      favorites.addFavorite.mockResolvedValue({ _id: newObjectId(), targetType: 'folder', targetId: folderId, createdAt: now });

      const result = await controller.add({ targetType: 'folder', targetId: folderId.toString() });

      expect(permissions.canRead).toHaveBeenCalledWith(folderId.toString());
      expect(favorites.addFavorite).toHaveBeenCalledWith('folder', folderId);
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'favorite.added' }));
      expect(result).toMatchObject({ targetType: 'folder', name: 'Sales' });
    });

    it('is idempotent — re-adding an existing favorite returns it without a duplicate create or a second audit event', async () => {
      const folderId = newObjectId();
      folders.findById.mockResolvedValue({ _id: folderId, name: 'Sales' });
      permissions.canRead.mockResolvedValue(true);
      const existing = { _id: newObjectId(), targetType: 'folder', targetId: folderId, createdAt: new Date() };
      favorites.findOne.mockResolvedValue(existing);

      const result = await controller.add({ targetType: 'folder', targetId: folderId.toString() });

      expect(favorites.addFavorite).not.toHaveBeenCalled();
      expect(auditEvents.record).not.toHaveBeenCalled();
      expect(result.id).toBe(existing._id.toString());
    });

    it('treats a duplicate-key collision from a concurrent add as the same idempotent success, not a 500', async () => {
      const folderId = newObjectId();
      folders.findById.mockResolvedValue({ _id: folderId, name: 'Sales' });
      permissions.canRead.mockResolvedValue(true);
      const winner = { _id: newObjectId(), targetType: 'folder', targetId: folderId, createdAt: new Date() };
      favorites.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      const dupKeyError = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      favorites.addFavorite.mockRejectedValue(dupKeyError);

      const result = await controller.add({ targetType: 'folder', targetId: folderId.toString() });

      expect(result.id).toBe(winner._id.toString());
      expect(auditEvents.record).not.toHaveBeenCalled();
    });

    it('404s when the target document/folder no longer exists', async () => {
      const targetId = newObjectId();
      folders.findById.mockResolvedValue(null);

      await expect(controller.add({ targetType: 'folder', targetId: targetId.toString() })).rejects.toThrow(NotFoundException);
      expect(permissions.canRead).not.toHaveBeenCalled();
    });

    it('404s when the caller no longer has read access to the target folder', async () => {
      const folderId = newObjectId();
      folders.findById.mockResolvedValue({ _id: folderId, name: 'Sales' });
      permissions.canRead.mockResolvedValue(false);

      await expect(controller.add({ targetType: 'folder', targetId: folderId.toString() })).rejects.toThrow(NotFoundException);
      expect(favorites.addFavorite).not.toHaveBeenCalled();
    });

    it('resolves a document favorite through its containing folder for the access check', async () => {
      const docId = newObjectId();
      const folderId = newObjectId();
      documents.findById.mockResolvedValue({ _id: docId, name: 'Report.pdf', folderId });
      permissions.canRead.mockResolvedValue(true);
      favorites.findOne.mockResolvedValue(null);
      favorites.addFavorite.mockResolvedValue({ _id: newObjectId(), targetType: 'document', targetId: docId, createdAt: new Date() });

      const result = await controller.add({ targetType: 'document', targetId: docId.toString() });

      expect(permissions.canRead).toHaveBeenCalledWith(folderId.toString());
      expect(result).toMatchObject({ targetType: 'document', name: 'Report.pdf', folderId: folderId.toString() });
    });
  });

  describe('list', () => {
    it('silently drops a favorite whose target was deleted since favoriting', async () => {
      const deletedFolderId = newObjectId();
      favorites.listForOwner.mockResolvedValue([{ _id: newObjectId(), targetType: 'folder', targetId: deletedFolderId, createdAt: new Date() }]);
      folders.findById.mockResolvedValue(null);

      const result = await controller.list();

      expect(result).toEqual([]);
    });

    it('silently drops a favorite whose read access was revoked since favoriting', async () => {
      const folderId = newObjectId();
      favorites.listForOwner.mockResolvedValue([{ _id: newObjectId(), targetType: 'folder', targetId: folderId, createdAt: new Date() }]);
      folders.findById.mockResolvedValue({ _id: folderId, name: 'Sales' });
      permissions.permittedReadFolderIds.mockResolvedValue([]);

      const result = await controller.list();

      expect(result).toEqual([]);
    });

    it('returns still-accessible favorites', async () => {
      const folderId = newObjectId();
      const now = new Date();
      favorites.listForOwner.mockResolvedValue([{ _id: newObjectId(), targetType: 'folder', targetId: folderId, createdAt: now }]);
      folders.findById.mockResolvedValue({ _id: folderId, name: 'Sales' });
      permissions.permittedReadFolderIds.mockResolvedValue([folderId.toString()]);

      const result = await controller.list();

      expect(result).toEqual([expect.objectContaining({ targetType: 'folder', name: 'Sales', folderId: folderId.toString() })]);
    });

    it('resolves permittedReadFolderIds once regardless of favorite count, not once per favorite', async () => {
      const folderIds = [newObjectId(), newObjectId(), newObjectId()];
      favorites.listForOwner.mockResolvedValue(folderIds.map((id) => ({ _id: newObjectId(), targetType: 'folder', targetId: id, createdAt: new Date() })));
      folders.findById.mockImplementation(async (id: ReturnType<typeof newObjectId>) => ({ _id: id, name: 'F' }));
      permissions.permittedReadFolderIds.mockResolvedValue(folderIds.map((id) => id.toString()));

      const result = await controller.list();

      expect(result).toHaveLength(3);
      expect(permissions.permittedReadFolderIds).toHaveBeenCalledTimes(1);
      expect(permissions.canRead).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('removes an existing favorite and audits it', async () => {
      const folderId = newObjectId();
      favorites.findOne.mockResolvedValue({ _id: newObjectId(), targetType: 'folder', targetId: folderId });

      const result = await controller.remove('folder', folderId.toString());

      expect(favorites.removeFavorite).toHaveBeenCalledWith('folder', folderId);
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'favorite.removed' }));
      expect(result).toEqual({ removed: true });
    });

    it('404s when the favorite does not exist', async () => {
      favorites.findOne.mockResolvedValue(null);

      await expect(controller.remove('folder', newObjectId().toString())).rejects.toThrow(NotFoundException);
      expect(favorites.removeFavorite).not.toHaveBeenCalled();
    });

    it('404s on a malformed targetType path param', async () => {
      await expect(controller.remove('bogus', newObjectId().toString())).rejects.toThrow(NotFoundException);
      expect(favorites.findOne).not.toHaveBeenCalled();
    });

    it('404s (not 500) on a malformed targetId path param', async () => {
      await expect(controller.remove('folder', 'not-a-valid-object-id')).rejects.toThrow(NotFoundException);
      expect(favorites.findOne).not.toHaveBeenCalled();
    });
  });
});
