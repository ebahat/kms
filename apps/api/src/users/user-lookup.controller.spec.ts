import { BadRequestException, NotFoundException } from '@nestjs/common';
import { newObjectId } from '@kms/data';
import { UserLookupController } from './user-lookup.controller';

describe('UserLookupController (2026-08-28 bug fix — resolves an email to a userId for group-membership/folder-grant pickers)', () => {
  let users: any;
  let controller: UserLookupController;

  beforeEach(() => {
    users = { findByEmailInTenant: jest.fn() };
    controller = new UserLookupController(users);
  });

  it('rejects a missing/empty email with 400, before ever querying', async () => {
    await expect(controller.lookup(undefined)).rejects.toThrow(BadRequestException);
    await expect(controller.lookup('   ')).rejects.toThrow(BadRequestException);
    expect(users.findByEmailInTenant).not.toHaveBeenCalled();
  });

  it('404s when no user in this tenant has that email', async () => {
    users.findByEmailInTenant.mockResolvedValue(null);
    await expect(controller.lookup('nobody@example.com')).rejects.toThrow(NotFoundException);
  });

  it('returns id/email/name composed from firstName+lastName', async () => {
    const id = newObjectId();
    users.findByEmailInTenant.mockResolvedValue({ _id: id, email: 'dana@example.com', firstName: 'דנה', lastName: 'כהן' });

    const result = await controller.lookup('dana@example.com');

    expect(result).toEqual({ id: id.toString(), email: 'dana@example.com', name: 'דנה כהן' });
  });

  it('falls back to the email as the display name when firstName/lastName are both absent', async () => {
    const id = newObjectId();
    users.findByEmailInTenant.mockResolvedValue({ _id: id, email: 'legacy@example.com' });

    const result = await controller.lookup('legacy@example.com');

    expect(result.name).toBe('legacy@example.com');
  });

  it('never returns admin-only fields (role/status/mfaEnabled/lastLoginAt) — only id/email/name', async () => {
    const id = newObjectId();
    users.findByEmailInTenant.mockResolvedValue({
      _id: id,
      email: 'x@y.com',
      role: 'admin',
      status: 'active',
      mfaEnabled: true,
      lastLoginAt: new Date(),
      passwordHash: 'secret-hash',
    });

    const result = await controller.lookup('x@y.com');

    expect(Object.keys(result).sort()).toEqual(['email', 'id', 'name']);
  });
});
