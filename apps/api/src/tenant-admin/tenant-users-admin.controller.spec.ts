import { ConflictException, NotFoundException } from '@nestjs/common';
import { TenantUsersAdminController } from './tenant-users-admin.controller';

const PEPPER = 'test-pepper';

function fakeObjectIdHex(): string {
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

describe('TenantUsersAdminController (PRD §6 tenant-admin user management)', () => {
  let users: any;
  let sessions: any;
  let controller: TenantUsersAdminController;

  beforeEach(() => {
    users = {
      find: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      updateOne: jest.fn().mockResolvedValue(undefined),
    };
    sessions = { revokeAll: jest.fn().mockResolvedValue(undefined) };
    controller = new TenantUsersAdminController(users, sessions, PEPPER);
  });

  describe('list', () => {
    it('maps documents to summaries without leaking passwordHash/totp secrets', async () => {
      users.find.mockResolvedValue([
        {
          _id: fakeObjectIdHex(),
          email: 'a@b.com',
          role: 'user',
          status: 'active',
          mfaEnabled: true,
          passwordHash: 'should-not-appear',
          totpSecretEnvelope: { ciphertext: 'x', wrappedKey: 'y', iv: 'z', authTag: 'w' },
        },
      ]);

      const result = await controller.list();

      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('passwordHash');
      expect(result[0]).not.toHaveProperty('totpSecretEnvelope');
      expect(result[0].email).toBe('a@b.com');
    });
  });

  describe('create', () => {
    it('creates a user and returns a temp password', async () => {
      const userId = fakeObjectIdHex();
      users.create.mockResolvedValue({ _id: userId, email: 'new@x.com' });

      const result = await controller.create({ email: 'new@x.com', role: 'user' });

      expect(result.userId).toBe(userId.toString());
      expect(result.email).toBe('new@x.com');
      expect(result.tempPassword.length).toBeGreaterThanOrEqual(12);
      expect(users.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@x.com', role: 'user', status: 'active' }));
    });

    it('surfaces a duplicate email as 409 Conflict', async () => {
      users.create.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));

      await expect(controller.create({ email: 'dup@x.com', role: 'user' })).rejects.toThrow(ConflictException);
    });
  });

  describe('deactivate', () => {
    it('404s for a user id that does not resolve within this tenant scope', async () => {
      users.findById.mockResolvedValue(null);
      await expect(controller.deactivate(fakeObjectIdHex())).rejects.toThrow(NotFoundException);
    });

    it('sets status inactive and revokes all sessions', async () => {
      const userId = fakeObjectIdHex();
      users.findById.mockResolvedValue({ _id: userId });

      const result = await controller.deactivate(userId);

      expect(result).toEqual({ ok: true });
      expect(users.updateOne).toHaveBeenCalledWith({ _id: expect.anything() }, { $set: { status: 'inactive' } });
      expect(sessions.revokeAll).toHaveBeenCalledWith('tenant', userId.toString());
    });
  });

  describe('reactivate', () => {
    it('sets status back to active', async () => {
      const userId = fakeObjectIdHex();
      users.findById.mockResolvedValue({ _id: userId });

      const result = await controller.reactivate(userId);

      expect(result).toEqual({ ok: true });
      expect(users.updateOne).toHaveBeenCalledWith({ _id: expect.anything() }, { $set: { status: 'active' } });
    });
  });

  describe('importCsv', () => {
    it('creates valid rows and reports per-row errors for invalid ones, preserving row numbers', async () => {
      users.create
        .mockResolvedValueOnce({ _id: fakeObjectIdHex(), email: 'good1@x.com' })
        .mockResolvedValueOnce({ _id: fakeObjectIdHex(), email: 'good2@x.com' });

      const csvContent = ['email,role', 'good1@x.com,user', 'not-an-email,user', 'good2@x.com,admin'].join('\n');

      const { results } = await controller.importCsv({ csvContent });

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ row: 1, email: 'good1@x.com', status: 'created' });
      expect(results[1].status).toBe('error');
      expect(results[1].row).toBe(2);
      expect(results[2]).toEqual({ row: 3, email: 'good2@x.com', status: 'created' });
      expect(users.create).toHaveBeenCalledTimes(2);
    });

    it('reports a duplicate-email row as an error without aborting the rest of the import', async () => {
      users.create
        .mockRejectedValueOnce(Object.assign(new Error('E11000'), { code: 11000 }))
        .mockResolvedValueOnce({ _id: fakeObjectIdHex(), email: 'ok@x.com' });

      const csvContent = ['email,role', 'dup@x.com,user', 'ok@x.com,user'].join('\n');
      const { results } = await controller.importCsv({ csvContent });

      expect(results[0]).toEqual({ row: 1, email: 'dup@x.com', status: 'error', error: 'email already exists' });
      expect(results[1]).toEqual({ row: 2, email: 'ok@x.com', status: 'created' });
    });
  });
});
