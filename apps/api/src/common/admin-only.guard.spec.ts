import { ForbiddenException } from '@nestjs/common';
import { AdminOnlyGuard } from './admin-only.guard';
import { SCOPE_CLS_KEY } from '@kms/data';

class FakeCls {
  private store = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  set(key: string, value: unknown) {
    this.store.set(key, value);
  }
}

describe('AdminOnlyGuard (PRD §6/§7 interim role check)', () => {
  it('allows an admin-role scope through', () => {
    const cls = new FakeCls();
    cls.set(SCOPE_CLS_KEY, { role: 'admin' });
    const guard = new AdminOnlyGuard(cls as any);
    expect(guard.canActivate()).toBe(true);
  });

  it('rejects a user-role scope', () => {
    const cls = new FakeCls();
    cls.set(SCOPE_CLS_KEY, { role: 'user' });
    const guard = new AdminOnlyGuard(cls as any);
    expect(() => guard.canActivate()).toThrow(ForbiddenException);
  });

  it('rejects when there is no scope at all', () => {
    const guard = new AdminOnlyGuard(new FakeCls() as any);
    expect(() => guard.canActivate()).toThrow(ForbiddenException);
  });
});
