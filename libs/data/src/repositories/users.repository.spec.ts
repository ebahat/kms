import { Types } from 'mongoose';
import { UsersRepository } from './users.repository';
import { SystemScope } from '../system-scope';
import { SCOPE_CLS_KEY, Scope } from '../scope';

/** Minimal fake standing in for nestjs-cls's ClsService, incl. .run() for SystemScope. */
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

describe('UsersRepository.findByEmailForAuth (pre-auth cross-tenant lookup)', () => {
  it('bypasses tenant scope via SystemScope.run and queries by email alone', async () => {
    const cls = new FakeCls();
    const found = { _id: new Types.ObjectId(), email: 'a@b.com', tenantId: new Types.ObjectId() };
    const model = { modelName: 'User', findOne: jest.fn().mockResolvedValue(found) };

    const repo = new UsersRepository(model as any, cls as any);
    const result = await repo.findByEmailForAuth('  A@B.com ');

    expect(model.findOne).toHaveBeenCalledWith({ email: 'a@b.com' });
    expect(result).toBe(found);
  });

  it('sets the SystemScope flag only for the duration of the lookup', async () => {
    const cls = new FakeCls();
    let flagDuringCall: boolean | undefined;
    const model = {
      modelName: 'User',
      findOne: jest.fn().mockImplementation(async () => {
        flagDuringCall = SystemScope.isActive(cls as any);
        return null;
      }),
    };

    const repo = new UsersRepository(model as any, cls as any);
    await repo.findByEmailForAuth('x@y.com');

    expect(flagDuringCall).toBe(true);
  });

  it('does not require any tenant scope to be set beforehand', async () => {
    const cls = new FakeCls(); // no SCOPE_CLS_KEY set at all
    const model = { modelName: 'User', findOne: jest.fn().mockResolvedValue(null) };

    const repo = new UsersRepository(model as any, cls as any);
    await expect(repo.findByEmailForAuth('nobody@nowhere.com')).resolves.toBeNull();
  });

  it('normal ScopedRepository methods on the same repo still require scope (fail closed)', () => {
    const cls = new FakeCls();
    const model = { modelName: 'User', find: jest.fn() };
    const repo = new UsersRepository(model as any, cls as any);

    expect(() => (repo as any).scope()).toThrow();

    const tenantId = new Types.ObjectId();
    const scope: Scope = { tenantId, userId: new Types.ObjectId(), role: 'admin', edition: 'kb' };
    cls.set(SCOPE_CLS_KEY, scope);
    repo.find({});
    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId }));
  });
});
