import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { toObjectId } from '@kms/data';
import { TenantUsersAdminController, parseCsvGroupsCell } from './tenant-users-admin.controller';

const PEPPER = 'test-pepper';

function fakeObjectIdHex(): string {
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

describe('TenantUsersAdminController (PRD §6 tenant-admin user management)', () => {
  let users: any;
  let groups: any;
  let auditEvents: any;
  let cls: any;
  let sessions: any;
  let notifications: any;
  let cache: any;
  let controller: TenantUsersAdminController;

  const tenantId = fakeObjectIdHex();

  beforeEach(() => {
    users = {
      find: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      updateOne: jest.fn().mockResolvedValue(undefined),
    };
    groups = {
      findById: jest.fn(),
      findOneByName: jest.fn(),
      findForMember: jest.fn().mockResolvedValue([]),
      setMember: jest.fn().mockResolvedValue(undefined),
      removeMembers: jest.fn().mockResolvedValue(undefined),
    };
    auditEvents = { record: jest.fn().mockResolvedValue(undefined) };
    cls = { get: jest.fn().mockReturnValue({ tenantId, userId: fakeObjectIdHex(), role: 'admin' }) };
    sessions = { revokeAll: jest.fn().mockResolvedValue(undefined) };
    notifications = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    cache = { bumpVersion: jest.fn().mockResolvedValue(1) };
    controller = new TenantUsersAdminController(users, groups, auditEvents, cls, sessions, PEPPER, notifications, cache);
  });

  describe('list', () => {
    it('maps documents to summaries without leaking passwordHash/totp secrets', async () => {
      users.find.mockResolvedValue([
        {
          _id: fakeObjectIdHex(),
          email: 'a@b.com',
          firstName: 'Israel',
          lastName: 'Cohen',
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
      expect(result[0].firstName).toBe('Israel');
      expect(result[0].lastName).toBe('Cohen');
    });

    it('leaves firstName/lastName undefined for a legacy user created before the field existed', async () => {
      users.find.mockResolvedValue([{ _id: fakeObjectIdHex(), email: 'legacy@b.com', role: 'user', status: 'active', mfaEnabled: false }]);

      const result = await controller.list();

      expect(result[0].firstName).toBeUndefined();
      expect(result[0].lastName).toBeUndefined();
    });

    it('passes a pending user’s status through untouched', async () => {
      users.find.mockResolvedValue([{ _id: fakeObjectIdHex(), email: 'invited@b.com', role: 'user', status: 'pending', mfaEnabled: false }]);

      const result = await controller.list();

      expect(result[0].status).toBe('pending');
    });
  });

  describe('create', () => {
    it('creates a pending user, sends an invite email, and never returns a temp password', async () => {
      const userId = fakeObjectIdHex();
      users.create.mockResolvedValue({ _id: userId, email: 'new@x.com' });

      const result = await controller.create({ email: 'new@x.com', firstName: 'Israel', lastName: 'Cohen', role: 'user' });

      expect(result).toEqual({ userId, email: 'new@x.com', status: 'pending' });
      expect(result).not.toHaveProperty('tempPassword');
      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@x.com', firstName: 'Israel', lastName: 'Cohen', role: 'user', status: 'pending' }),
      );
      expect(notifications.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'new@x.com' }));
      expect(users.updateOne).toHaveBeenCalledWith(
        { _id: userId },
        { $set: { inviteTokenHash: expect.any(String), inviteExpiresAt: expect.any(Date) } },
      );
    });

    it('rejects a missing first/last name', async () => {
      await expect(controller.create({ email: 'new@x.com', role: 'user' })).rejects.toThrow();
      expect(users.create).not.toHaveBeenCalled();
    });

    it('surfaces a duplicate email as 409 Conflict', async () => {
      users.create.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));

      await expect(controller.create({ email: 'dup@x.com', firstName: 'Israel', lastName: 'Cohen', role: 'user' })).rejects.toThrow(ConflictException);
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });

    it('rejects a group id that does not resolve within this tenant, before creating the user', async () => {
      groups.findById.mockResolvedValue(null);
      const badGroupId = fakeObjectIdHex();

      await expect(
        controller.create({ email: 'new@x.com', firstName: 'Israel', lastName: 'Cohen', role: 'user', groups: [{ groupId: badGroupId, role: 'viewer' }] }),
      ).rejects.toThrow(BadRequestException);
      expect(users.create).not.toHaveBeenCalled();
    });

    it('assigns the requested groups with their roles, and bumps permVersion once', async () => {
      const userId = fakeObjectIdHex();
      const groupId = fakeObjectIdHex();
      users.create.mockResolvedValue({ _id: userId, email: 'new@x.com' });
      groups.findById.mockResolvedValue({ _id: groupId });

      await controller.create({
        email: 'new@x.com',
        firstName: 'Israel',
        lastName: 'Cohen',
        role: 'user',
        groups: [{ groupId, role: 'editor' }],
      });

      expect(groups.setMember).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'editor');
      expect(cache.bumpVersion).toHaveBeenCalledWith(tenantId);
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.groups.updated' }));
    });
  });

  describe('update', () => {
    it('rejects an empty patch', async () => {
      await expect(controller.update(fakeObjectIdHex(), {})).rejects.toThrow(BadRequestException);
    });

    it('404s for a user id that does not resolve within this tenant scope', async () => {
      users.findById.mockResolvedValue(null);
      await expect(controller.update(fakeObjectIdHex(), { firstName: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('404s a malformed id instead of throwing an unhandled BSON error — security review finding, 2026-08-24', async () => {
      await expect(controller.update('not-an-object-id', { firstName: 'X' })).rejects.toThrow(NotFoundException);
      expect(users.findById).not.toHaveBeenCalled();
    });

    it('a no-op PATCH with the same (case-different) email does not attempt an update or 409', async () => {
      const userId = fakeObjectIdHex();
      users.findById.mockResolvedValue({ _id: userId, email: 'same@x.com', role: 'user', status: 'active' });

      await controller.update(userId, { email: 'Same@X.com' });

      expect(users.updateOne).not.toHaveBeenCalled();
    });

    it('surfaces a genuine email change that collides with another user as 409', async () => {
      const userId = fakeObjectIdHex();
      users.findById.mockResolvedValue({ _id: userId, email: 'old@x.com', role: 'user', status: 'active' });
      users.updateOne.mockRejectedValueOnce(Object.assign(new Error('E11000'), { code: 11000 }));

      await expect(controller.update(userId, { email: 'taken@x.com' })).rejects.toThrow(ConflictException);
    });

    it('revokes all sessions when role changes', async () => {
      const userId = fakeObjectIdHex();
      users.findById.mockResolvedValueOnce({ _id: userId, email: 'x@x.com', role: 'user', status: 'active' });
      users.findById.mockResolvedValueOnce({ _id: userId, email: 'x@x.com', role: 'admin', status: 'active' });

      await controller.update(userId, { role: 'admin' });

      expect(sessions.revokeAll).toHaveBeenCalledWith('tenant', userId);
    });

    it('does not revoke sessions when role is unchanged', async () => {
      const userId = fakeObjectIdHex();
      users.findById.mockResolvedValue({ _id: userId, email: 'x@x.com', role: 'user', status: 'active' });

      await controller.update(userId, { role: 'user' });

      expect(sessions.revokeAll).not.toHaveBeenCalled();
    });

    it('re-issues the invite when a still-pending user’s email changes', async () => {
      const userId = fakeObjectIdHex();
      // Three findById calls in this scenario: initial lookup, the post-update refetch that feeds
      // issueInvite's "to" address, and the final refetch for the response toSummary().
      users.findById.mockResolvedValueOnce({ _id: userId, email: 'old@x.com', role: 'user', status: 'pending' });
      users.findById.mockResolvedValueOnce({ _id: userId, email: 'new@x.com', role: 'user', status: 'pending' });
      users.findById.mockResolvedValueOnce({ _id: userId, email: 'new@x.com', role: 'user', status: 'pending' });

      await controller.update(userId, { email: 'new@x.com' });

      expect(notifications.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'new@x.com' }));
    });

    it('does not re-issue an invite when an already-active user’s email changes', async () => {
      const userId = fakeObjectIdHex();
      users.findById.mockResolvedValueOnce({ _id: userId, email: 'old@x.com', role: 'user', status: 'active' });
      users.findById.mockResolvedValueOnce({ _id: userId, email: 'new@x.com', role: 'user', status: 'active' });

      await controller.update(userId, { email: 'new@x.com' });

      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });

    it('diffs group memberships: adds a new group, changes an existing role, and removes a dropped one', async () => {
      const userId = fakeObjectIdHex();
      const keepGroupId = fakeObjectIdHex();
      const dropGroupId = fakeObjectIdHex();
      const addGroupId = fakeObjectIdHex();
      users.findById.mockResolvedValue({ _id: userId, email: 'x@x.com', role: 'user', status: 'active' });
      groups.findById.mockResolvedValue({ _id: addGroupId }); // assertGroupsExist target
      // Real ObjectId-like values (not the raw hex string) — the controller compares via
      // .equals(), which only real mongoose ObjectIds (or this shared toObjectId() helper) provide.
      groups.findForMember.mockResolvedValue([
        { _id: keepGroupId, members: [{ userId: toObjectId(userId), role: 'viewer' }] },
        { _id: dropGroupId, members: [{ userId: toObjectId(userId), role: 'editor' }] },
      ]);

      await controller.update(userId, {
        groups: [
          { groupId: keepGroupId, role: 'manager' }, // role change
          { groupId: addGroupId, role: 'viewer' }, // new
        ],
      });

      expect(groups.setMember).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'manager');
      expect(groups.setMember).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'viewer');
      expect(groups.removeMembers).toHaveBeenCalledWith(expect.anything(), [expect.anything()]);
      expect(cache.bumpVersion).toHaveBeenCalledWith(tenantId);
    });

    it('does not touch group memberships or bump permVersion when groups is omitted from the patch', async () => {
      const userId = fakeObjectIdHex();
      users.findById.mockResolvedValue({ _id: userId, email: 'x@x.com', role: 'user', status: 'active' });

      await controller.update(userId, { firstName: 'New' });

      expect(groups.setMember).not.toHaveBeenCalled();
      expect(groups.removeMembers).not.toHaveBeenCalled();
      expect(cache.bumpVersion).not.toHaveBeenCalled();
    });
  });

  describe('resendInvite', () => {
    it('404s for a user id that does not resolve within this tenant scope', async () => {
      users.findById.mockResolvedValue(null);
      await expect(controller.resendInvite(fakeObjectIdHex())).rejects.toThrow(NotFoundException);
    });

    it('404s a malformed id — security review finding, 2026-08-24', async () => {
      await expect(controller.resendInvite('not-an-object-id')).rejects.toThrow(NotFoundException);
      expect(users.findById).not.toHaveBeenCalled();
    });

    it('409s for a user who is not pending', async () => {
      users.findById.mockResolvedValue({ _id: fakeObjectIdHex(), email: 'x@x.com', status: 'active' });
      await expect(controller.resendInvite(fakeObjectIdHex())).rejects.toThrow(ConflictException);
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });

    it('mints a fresh token and re-sends for a pending user', async () => {
      const userId = fakeObjectIdHex();
      users.findById.mockResolvedValue({ _id: userId, email: 'x@x.com', status: 'pending' });

      await controller.resendInvite(userId);

      expect(notifications.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'x@x.com' }));
    });
  });

  describe('deactivate', () => {
    it('404s for a user id that does not resolve within this tenant scope', async () => {
      users.findById.mockResolvedValue(null);
      await expect(controller.deactivate(fakeObjectIdHex())).rejects.toThrow(NotFoundException);
    });

    it('404s a malformed id — security review finding, 2026-08-24', async () => {
      await expect(controller.deactivate('not-an-object-id')).rejects.toThrow(NotFoundException);
      expect(users.findById).not.toHaveBeenCalled();
    });

    it('sets status inactive, unsets both the invite and reset token pairs, and revokes all sessions', async () => {
      const userId = fakeObjectIdHex();
      users.findById.mockResolvedValue({ _id: userId, status: 'active', activatedAt: new Date('2026-01-01') });

      const result = await controller.deactivate(userId);

      expect(result).toEqual({ ok: true });
      expect(users.updateOne).toHaveBeenCalledWith(
        { _id: expect.anything() },
        {
          $set: { status: 'inactive' },
          $unset: { inviteTokenHash: '', inviteExpiresAt: '', passwordResetTokenHash: '', passwordResetExpiresAt: '' },
        },
      );
      expect(sessions.revokeAll).toHaveBeenCalledWith('tenant', userId);
    });

    it('backfills activatedAt for a pre-existing active user who never went through the activation flow — security review finding, 2026-08-24', async () => {
      const userId = fakeObjectIdHex();
      users.findById.mockResolvedValue({ _id: userId, status: 'active', activatedAt: undefined });

      await controller.deactivate(userId);

      expect(users.updateOne).toHaveBeenCalledWith(
        { _id: expect.anything() },
        expect.objectContaining({ $set: { status: 'inactive', activatedAt: expect.any(Date) } }),
      );
    });

    it('does not overwrite an already-set activatedAt', async () => {
      const userId = fakeObjectIdHex();
      const original = new Date('2026-01-01');
      users.findById.mockResolvedValue({ _id: userId, status: 'active', activatedAt: original });

      await controller.deactivate(userId);

      expect(users.updateOne).toHaveBeenCalledWith({ _id: expect.anything() }, expect.objectContaining({ $set: { status: 'inactive' } }));
    });

    it('does not backfill activatedAt for a user who was still pending', async () => {
      const userId = fakeObjectIdHex();
      users.findById.mockResolvedValue({ _id: userId, status: 'pending', activatedAt: undefined });

      await controller.deactivate(userId);

      expect(users.updateOne).toHaveBeenCalledWith({ _id: expect.anything() }, expect.objectContaining({ $set: { status: 'inactive' } }));
    });
  });

  describe('reactivate', () => {
    it('404s a malformed id — security review finding, 2026-08-24', async () => {
      await expect(controller.reactivate('not-an-object-id')).rejects.toThrow(NotFoundException);
      expect(users.findById).not.toHaveBeenCalled();
    });

    it('goes straight back to active, with no email, for a user who previously completed activation', async () => {
      const userId = fakeObjectIdHex();
      users.findById.mockResolvedValue({ _id: userId, email: 'x@x.com', activatedAt: new Date('2026-01-01') });

      const result = await controller.reactivate(userId);

      expect(result).toEqual({ ok: true });
      expect(users.updateOne).toHaveBeenCalledWith({ _id: expect.anything() }, { $set: { status: 'active' } });
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });

    it('goes back to pending with a fresh invite email for a user who never completed activation', async () => {
      const userId = fakeObjectIdHex();
      users.findById.mockResolvedValue({ _id: userId, email: 'x@x.com', activatedAt: undefined });

      const result = await controller.reactivate(userId);

      expect(result).toEqual({ ok: true });
      expect(users.updateOne).toHaveBeenCalledWith({ _id: expect.anything() }, { $set: { status: 'pending' } });
      expect(notifications.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'x@x.com' }));
    });
  });

  describe('importCsv', () => {
    it('creates valid rows and reports per-row errors for invalid ones, preserving row numbers', async () => {
      users.create
        .mockResolvedValueOnce({ _id: fakeObjectIdHex(), email: 'good1@x.com' })
        .mockResolvedValueOnce({ _id: fakeObjectIdHex(), email: 'good2@x.com' });

      const csvContent = [
        'email,firstName,lastName,role',
        'good1@x.com,Israel,Cohen,user',
        'not-an-email,Israel,Cohen,user',
        'good2@x.com,Rachel,Levi,admin',
      ].join('\n');

      const { results } = await controller.importCsv({ csvContent });

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ row: 1, email: 'good1@x.com', status: 'created' });
      expect(results[1].status).toBe('error');
      expect(results[1].row).toBe(2);
      expect(results[2]).toEqual({ row: 3, email: 'good2@x.com', status: 'created' });
      expect(users.create).toHaveBeenCalledTimes(2);
      expect(notifications.sendEmail).toHaveBeenCalledTimes(2);
    });

    it('reports a duplicate-email row as an error without aborting the rest of the import', async () => {
      users.create
        .mockRejectedValueOnce(Object.assign(new Error('E11000'), { code: 11000 }))
        .mockResolvedValueOnce({ _id: fakeObjectIdHex(), email: 'ok@x.com' });

      const csvContent = ['email,firstName,lastName,role', 'dup@x.com,Israel,Cohen,user', 'ok@x.com,Rachel,Levi,user'].join('\n');
      const { results } = await controller.importCsv({ csvContent });

      expect(results[0]).toEqual({ row: 1, email: 'dup@x.com', status: 'error', error: 'email already exists' });
      expect(results[1]).toEqual({ row: 2, email: 'ok@x.com', status: 'created' });
    });

    it('creates memberships for a valid groups cell, resolving group names to ids', async () => {
      const groupId = fakeObjectIdHex();
      users.create.mockResolvedValue({ _id: fakeObjectIdHex(), email: 'ok@x.com' });
      groups.findOneByName.mockImplementation((name: string) => (name === 'Sales' ? { _id: groupId } : null));

      const csvContent = ['email,firstName,lastName,role,groups', 'ok@x.com,Israel,Cohen,user,Sales:editor'].join('\n');
      const { results } = await controller.importCsv({ csvContent });

      expect(results[0].status).toBe('created');
      expect(groups.setMember).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'editor');
    });

    it('reports an unknown group name as a row error and never creates that user', async () => {
      groups.findOneByName.mockResolvedValue(null);

      const csvContent = ['email,firstName,lastName,role,groups', 'ok@x.com,Israel,Cohen,user,Ghost:viewer'].join('\n');
      const { results } = await controller.importCsv({ csvContent });

      expect(results[0]).toEqual({ row: 1, email: 'ok@x.com', status: 'error', error: 'unknown group: Ghost' });
      expect(users.create).not.toHaveBeenCalled();
    });

    it('reports an invalid role token in the groups cell as a row error', async () => {
      const csvContent = ['email,firstName,lastName,role,groups', 'ok@x.com,Israel,Cohen,user,Sales:owner'].join('\n');
      const { results } = await controller.importCsv({ csvContent });

      expect(results[0]).toEqual({ row: 1, email: 'ok@x.com', status: 'error', error: 'invalid groups cell' });
      expect(users.create).not.toHaveBeenCalled();
    });

    it('an empty groups cell creates the user with no memberships, not an error', async () => {
      users.create.mockResolvedValue({ _id: fakeObjectIdHex(), email: 'ok@x.com' });

      const csvContent = ['email,firstName,lastName,role,groups', 'ok@x.com,Israel,Cohen,user,'].join('\n');
      const { results } = await controller.importCsv({ csvContent });

      expect(results[0].status).toBe('created');
      expect(groups.setMember).not.toHaveBeenCalled();
    });
  });
});

describe('parseCsvGroupsCell', () => {
  it('parses a single name:role pair', () => {
    expect(parseCsvGroupsCell('Sales:editor')).toEqual([{ name: 'Sales', role: 'editor' }]);
  });

  it('parses multiple semicolon-separated pairs', () => {
    expect(parseCsvGroupsCell('Sales:editor;Legal:viewer')).toEqual([
      { name: 'Sales', role: 'editor' },
      { name: 'Legal', role: 'viewer' },
    ]);
  });

  it('returns [] for an empty or absent cell', () => {
    expect(parseCsvGroupsCell(undefined)).toEqual([]);
    expect(parseCsvGroupsCell('')).toEqual([]);
    expect(parseCsvGroupsCell('   ')).toEqual([]);
  });

  it('returns null for an invalid role token', () => {
    expect(parseCsvGroupsCell('Sales:owner')).toBeNull();
  });

  it('returns null for a malformed pair (missing role)', () => {
    expect(parseCsvGroupsCell('Sales')).toBeNull();
  });
});
