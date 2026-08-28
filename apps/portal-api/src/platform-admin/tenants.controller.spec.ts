import { ConflictException, NotFoundException } from '@nestjs/common';
import { newObjectId, SystemScope } from '@kms/data';
import { PlatformTenantsController } from './tenants.controller';

function fakeObjectIdHex(): string {
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);

class FakeCls {
  private store = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  set(key: string, value: unknown) {
    this.store.set(key, value);
  }
  run<T>(fn: () => T): T {
    return fn();
  }
}

describe('PlatformTenantsController (PRD §5 tenant lifecycle + Phase C provisioning)', () => {
  let tenants: any;
  let users: any;
  let storage: any;
  let sessions: any;
  let cls: FakeCls;
  let controller: PlatformTenantsController;

  beforeEach(() => {
    tenants = {
      find: jest.fn(),
      findById: jest.fn(),
      findBySubdomain: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      setStatus: jest.fn().mockResolvedValue(undefined),
      updateOne: jest.fn().mockResolvedValue(undefined),
      deleteById: jest.fn().mockResolvedValue(undefined),
    };
    users = { create: jest.fn(), find: jest.fn(), findById: jest.fn(), updateOne: jest.fn().mockResolvedValue(undefined) };
    storage = {
      putObject: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    sessions = { revokeAll: jest.fn().mockResolvedValue(undefined) };
    cls = new FakeCls();
    controller = new PlatformTenantsController(tenants, users, cls as any, 'test-pepper', storage, sessions);
  });

  it('list() runs under SystemScope, so the audited cross-tenant flag is active during the call', async () => {
    let flagDuringCall: boolean | undefined;
    tenants.find.mockImplementation(async () => {
      flagDuringCall = SystemScope.isActive(cls as any);
      return [{ name: 'Acme' }];
    });

    const result = await controller.list();

    expect(result).toEqual([{ name: 'Acme' }]);
    expect(flagDuringCall).toBe(true);
  });

  it('getOne() 404s for a missing tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(controller.getOne(fakeObjectIdHex())).rejects.toThrow(NotFoundException);
  });

  it('create() defaults storageQuotaBytes to 1 GiB when not specified', async () => {
    tenants.create.mockResolvedValue({ name: 'Acme', edition: 'kb' });
    await controller.create({ name: 'Acme', edition: 'kb' });
    expect(tenants.create).toHaveBeenCalledWith(expect.objectContaining({ storageQuotaBytes: 1_073_741_824 }));
  });

  it('suspend()/reactivate() flip status via setStatus()', async () => {
    const id = fakeObjectIdHex();
    await controller.suspend(id);
    expect(tenants.setStatus).toHaveBeenCalledWith(expect.anything(), 'suspended');
    await controller.reactivate(id);
    expect(tenants.setStatus).toHaveBeenCalledWith(expect.anything(), 'active');
  });

  it('setQuota() updates only storageQuotaBytes', async () => {
    const id = fakeObjectIdHex();
    await controller.setQuota(id, { storageQuotaBytes: 5_000_000_000 });
    expect(tenants.updateOne).toHaveBeenCalledWith(expect.anything(), { $set: { storageQuotaBytes: 5_000_000_000 } });
  });

  describe('checkSubdomain (Phase C, C1.5)', () => {
    it('is available when the format is valid and unused', async () => {
      tenants.findBySubdomain.mockResolvedValueOnce(null);
      await expect(controller.checkSubdomain({ value: 'acme' })).resolves.toEqual({ available: true });
    });

    it('is unavailable when already taken', async () => {
      tenants.findBySubdomain.mockResolvedValueOnce({ _id: newObjectId() });
      await expect(controller.checkSubdomain({ value: 'acme' })).resolves.toEqual({ available: false });
    });

    it('is unavailable for a reserved word, without querying the repository', async () => {
      await expect(controller.checkSubdomain({ value: 'admin' })).resolves.toEqual({ available: false });
      expect(tenants.findBySubdomain).not.toHaveBeenCalled();
    });

    it('is unavailable for an invalid format, without querying the repository', async () => {
      await expect(controller.checkSubdomain({ value: 'Not Valid!' })).resolves.toEqual({ available: false });
      expect(tenants.findBySubdomain).not.toHaveBeenCalled();
    });
  });

  describe('provision (Phase C, C1.2)', () => {
    const validBody = { name: 'Acme', edition: 'kb' as const, subdomain: 'acme', adminEmail: 'admin@acme.test' };

    it('creates the tenant and its first admin, returning a shown-once temp password', async () => {
      const tenantId = newObjectId();
      const adminId = newObjectId();
      tenants.create.mockResolvedValueOnce({ _id: tenantId, edition: 'kb' });
      users.create.mockResolvedValueOnce({ _id: adminId, email: 'admin@acme.test' });

      const result = await controller.provision(validBody);

      expect(tenants.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme', subdomain: 'acme', edition: 'kb' }));
      expect(users.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'admin@acme.test', role: 'admin' }));
      expect(result).toEqual({
        tenantId: tenantId.toString(),
        subdomain: 'acme',
        adminUserId: adminId.toString(),
        adminEmail: 'admin@acme.test',
        tempPassword: expect.any(String),
      });
      expect(result.tempPassword.length).toBeGreaterThanOrEqual(12);
    });

    it('rejects a reserved subdomain before creating anything', async () => {
      await expect(controller.provision({ ...validBody, subdomain: 'api' })).rejects.toThrow();
      expect(tenants.create).not.toHaveBeenCalled();
    });

    it('409s with SUBDOMAIN_TAKEN and creates nothing when the subdomain is already in use', async () => {
      tenants.findBySubdomain.mockResolvedValueOnce({ _id: newObjectId() });

      await expect(controller.provision(validBody)).rejects.toThrow(ConflictException);
      expect(tenants.create).not.toHaveBeenCalled();
      expect(users.create).not.toHaveBeenCalled();
    });

    it('rolls back (deletes) the tenant if admin-creation fails, and 409s with ADMIN_EMAIL_ALREADY_EXISTS', async () => {
      const tenantId = newObjectId();
      tenants.create.mockResolvedValueOnce({ _id: tenantId, edition: 'kb' });
      users.create.mockRejectedValueOnce(new Error('duplicate key'));

      await expect(controller.provision(validBody)).rejects.toThrow(ConflictException);
      expect(tenants.deleteById).toHaveBeenCalledWith(tenantId);
    });
  });

  describe('uploadLogo (Phase C, C1.3)', () => {
    it('404s for a missing tenant', async () => {
      tenants.findById.mockResolvedValueOnce(null);
      await expect(controller.uploadLogo(fakeObjectIdHex(), { buffer: PNG_BYTES } as any)).rejects.toThrow(NotFoundException);
    });

    it('rejects a missing file', async () => {
      tenants.findById.mockResolvedValueOnce({ _id: newObjectId() });
      await expect(controller.uploadLogo(fakeObjectIdHex(), undefined)).rejects.toThrow();
    });

    it('rejects a non-image file by content sniff, not extension', async () => {
      tenants.findById.mockResolvedValueOnce({ _id: newObjectId() });
      const notAnImage = Buffer.from('not an image at all');
      await expect(controller.uploadLogo(fakeObjectIdHex(), { buffer: notAnImage } as any)).rejects.toThrow();
      expect(storage.putObject).not.toHaveBeenCalled();
    });

    it('stores the object, updates the tenant, and deletes the previous logo on re-upload', async () => {
      const tenantId = newObjectId();
      tenants.findById.mockResolvedValueOnce({ _id: tenantId, logoObjectKey: 'tenants/x/logo/old.png' });

      const id = tenantId.toString();
      await controller.uploadLogo(id, { buffer: PNG_BYTES } as any);

      expect(storage.putObject).toHaveBeenCalledWith(
        expect.stringContaining(`tenants/${id}/logo/`),
        PNG_BYTES,
        expect.objectContaining({ contentType: 'image/png', disposition: 'inline' }),
      );
      expect(tenants.updateOne).toHaveBeenCalledWith(tenantId, { $set: { logoObjectKey: expect.stringContaining(`tenants/${id}/logo/`) } });
      expect(storage.deleteObject).toHaveBeenCalledWith('tenants/x/logo/old.png');
    });

    it('does not attempt to delete a previous logo when none existed', async () => {
      const tenantId = newObjectId();
      tenants.findById.mockResolvedValueOnce({ _id: tenantId });

      await controller.uploadLogo(tenantId.toString(), { buffer: PNG_BYTES } as any);

      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
  });

  describe('update (edit an existing tenant)', () => {
    it('404s for a missing tenant', async () => {
      tenants.findById.mockResolvedValueOnce(null);
      await expect(controller.update(fakeObjectIdHex(), { name: 'New Name' })).rejects.toThrow(NotFoundException);
    });

    it('only sets the fields present in the request', async () => {
      const tenantId = newObjectId();
      tenants.findById.mockResolvedValueOnce({ _id: tenantId, name: 'Old', edition: 'kb' });
      tenants.findById.mockResolvedValueOnce({ _id: tenantId, name: 'New Name', edition: 'kb' });

      await controller.update(tenantId.toString(), { name: 'New Name' });

      expect(tenants.updateOne).toHaveBeenCalledWith(tenantId, { $set: { name: 'New Name' } });
    });

    it('409s with SUBDOMAIN_TAKEN when the new subdomain belongs to a different tenant', async () => {
      const tenantId = newObjectId();
      const otherId = newObjectId();
      tenants.findById.mockResolvedValueOnce({ _id: tenantId, name: 'Old', edition: 'kb' });
      tenants.findBySubdomain.mockResolvedValueOnce({ _id: otherId });

      await expect(controller.update(tenantId.toString(), { subdomain: 'taken' })).rejects.toThrow(ConflictException);
      expect(tenants.updateOne).not.toHaveBeenCalled();
    });

    it('allows keeping a tenant\'s own current subdomain (not a self-conflict)', async () => {
      const tenantId = newObjectId();
      tenants.findById.mockResolvedValueOnce({ _id: tenantId, name: 'Old', edition: 'kb', subdomain: 'mine' });
      tenants.findBySubdomain.mockResolvedValueOnce({ _id: tenantId });
      tenants.findById.mockResolvedValueOnce({ _id: tenantId, name: 'Old', edition: 'kb', subdomain: 'mine' });

      await expect(controller.update(tenantId.toString(), { subdomain: 'mine' })).resolves.toBeDefined();
      expect(tenants.updateOne).toHaveBeenCalledWith(tenantId, { $set: { subdomain: 'mine' } });
    });
  });

  describe('listAdmins', () => {
    it('404s for a missing tenant', async () => {
      tenants.findById.mockResolvedValueOnce(null);
      await expect(controller.listAdmins(fakeObjectIdHex())).rejects.toThrow(NotFoundException);
    });

    it('lists only role:admin users, mapped to a summary', async () => {
      const tenantId = newObjectId();
      tenants.findById.mockResolvedValueOnce({ _id: tenantId, edition: 'kb' });
      users.find.mockResolvedValueOnce([{ _id: newObjectId(), email: 'a@acme.test', status: 'active' }]);

      const result = await controller.listAdmins(tenantId.toString());

      expect(users.find).toHaveBeenCalledWith({ role: 'admin' });
      expect(result).toEqual([{ id: expect.any(String), email: 'a@acme.test', status: 'active' }]);
    });
  });

  describe('resetAdminPassword', () => {
    it('404s for a missing tenant', async () => {
      tenants.findById.mockResolvedValueOnce(null);
      await expect(controller.resetAdminPassword(fakeObjectIdHex(), fakeObjectIdHex())).rejects.toThrow(NotFoundException);
    });

    it('404s when the user does not belong to this tenant (never a raw 403, sec §3.2)', async () => {
      const tenantId = newObjectId();
      tenants.findById.mockResolvedValueOnce({ _id: tenantId, edition: 'kb' });
      users.findById.mockResolvedValueOnce(null);

      await expect(controller.resetAdminPassword(tenantId.toString(), fakeObjectIdHex())).rejects.toThrow(NotFoundException);
    });

    it('sets a new password hash, revokes tenant sessions, and returns a shown-once temp password', async () => {
      const tenantId = newObjectId();
      const userId = newObjectId();
      tenants.findById.mockResolvedValueOnce({ _id: tenantId, edition: 'kb' });
      users.findById.mockResolvedValueOnce({ _id: userId, email: 'a@acme.test' });

      const result = await controller.resetAdminPassword(tenantId.toString(), userId.toString());

      expect(users.updateOne).toHaveBeenCalledWith({ _id: userId }, { $set: { passwordHash: expect.any(String) } });
      expect(sessions.revokeAll).toHaveBeenCalledWith('tenant', userId.toString());
      expect(result.tempPassword.length).toBeGreaterThanOrEqual(12);
    });

    it('still succeeds even if session revocation fails (best-effort, not fatal)', async () => {
      const tenantId = newObjectId();
      const userId = newObjectId();
      tenants.findById.mockResolvedValueOnce({ _id: tenantId, edition: 'kb' });
      users.findById.mockResolvedValueOnce({ _id: userId, email: 'a@acme.test' });
      sessions.revokeAll.mockRejectedValueOnce(new Error('redis-app unreachable'));

      await expect(controller.resetAdminPassword(tenantId.toString(), userId.toString())).resolves.toEqual({ tempPassword: expect.any(String) });
    });
  });
});
