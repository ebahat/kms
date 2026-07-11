import { Types } from 'mongoose';
import { PlatformAdminsRepository } from './platform-admins.repository';

describe('PlatformAdminsRepository (platform-admin realm, not tenant-scoped)', () => {
  const model = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('findByEmail() normalizes casing/whitespace', () => {
    const repo = new PlatformAdminsRepository(model as any);
    repo.findByEmail('  Admin@X.com ');
    expect(model.findOne).toHaveBeenCalledWith({ email: 'admin@x.com' });
  });

  it('findById() queries by _id only — no tenant filter exists to bypass', () => {
    const repo = new PlatformAdminsRepository(model as any);
    const id = new Types.ObjectId();
    repo.findById(id);
    expect(model.findOne).toHaveBeenCalledWith({ _id: id });
  });

  it('create() forwards the doc as-is', () => {
    const repo = new PlatformAdminsRepository(model as any);
    const doc = { email: 'a@b.com', passwordHash: 'h' };
    repo.create(doc);
    expect(model.create).toHaveBeenCalledWith(doc);
  });

  it('updateOne() targets a single admin by id', () => {
    const repo = new PlatformAdminsRepository(model as any);
    const id = new Types.ObjectId();
    repo.updateOne(id, { $set: { status: 'inactive' } });
    expect(model.updateOne).toHaveBeenCalledWith({ _id: id }, { $set: { status: 'inactive' } });
  });
});
