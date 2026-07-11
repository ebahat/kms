import { NotFoundException } from '@nestjs/common';
import { SystemScope } from '@kms/data';
import { PlatformTenantsController } from './tenants.controller';

function fakeObjectIdHex(): string {
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

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

describe('PlatformTenantsController (PRD §5 tenant lifecycle)', () => {
  let tenants: any;
  let cls: FakeCls;
  let controller: PlatformTenantsController;

  beforeEach(() => {
    tenants = {
      find: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      setStatus: jest.fn().mockResolvedValue(undefined),
      updateOne: jest.fn().mockResolvedValue(undefined),
    };
    cls = new FakeCls();
    controller = new PlatformTenantsController(tenants, cls as any);
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
});
