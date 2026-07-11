import { Types } from 'mongoose';
import { TenantsRepository } from './tenants.repository';

describe('TenantsRepository (platform-admin registry, not tenant-scoped)', () => {
  const model = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('find() passes the filter straight through — no scope() to bypass', () => {
    const repo = new TenantsRepository(model as any);
    repo.find({ status: 'active' } as any);
    expect(model.find).toHaveBeenCalledWith({ status: 'active' });
  });

  it('findById() queries by _id only', () => {
    const repo = new TenantsRepository(model as any);
    const id = new Types.ObjectId();
    repo.findById(id);
    expect(model.findOne).toHaveBeenCalledWith({ _id: id });
  });

  it('create() forwards the doc as-is', () => {
    const repo = new TenantsRepository(model as any);
    const doc = { name: 'Acme', edition: 'kb' as const, storageQuotaBytes: 1, featureToggles: [] };
    repo.create(doc);
    expect(model.create).toHaveBeenCalledWith(doc);
  });

  it('setStatus() updates only the status field', () => {
    const repo = new TenantsRepository(model as any);
    const id = new Types.ObjectId();
    repo.setStatus(id, 'suspended');
    expect(model.updateOne).toHaveBeenCalledWith({ _id: id }, { $set: { status: 'suspended' } });
  });
});
