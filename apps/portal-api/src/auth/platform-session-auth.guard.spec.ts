import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLATFORM_SCOPE_CLS_KEY } from '@kms/data';
import { PlatformSessionAuthGuard, MFA_VERIFIED_CLS_KEY } from './platform-session-auth.guard';

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
}

function fakeContext(cookies: Record<string, string> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ cookies }) }),
    getHandler: () => ({}) as any,
    getClass: () => ({}) as any,
  } as unknown as ExecutionContext;
}

describe('PlatformSessionAuthGuard (ADR-0004 platform realm)', () => {
  it('rejects a request with no platform session cookie', async () => {
    const sessions = { get: jest.fn(), touch: jest.fn() };
    const guard = new PlatformSessionAuthGuard(sessions as any, new FakeCls() as any, new Reflector());
    await expect(guard.canActivate(fakeContext())).rejects.toThrow(UnauthorizedException);
  });

  it('populates PlatformScope + mfaVerified from a valid session, with no tenantId/edition concept at all', async () => {
    const adminId = fakeObjectIdHex();
    const record = { userId: adminId, role: 'admin' as const, mfaVerified: true, createdAt: '', lastSeenAt: '' };
    const sessions = { get: jest.fn().mockResolvedValue(record), touch: jest.fn().mockResolvedValue(undefined) };
    const cls = new FakeCls();
    const guard = new PlatformSessionAuthGuard(sessions as any, cls as any, new Reflector());

    const result = await guard.canActivate(fakeContext({ '__Host-kms_padm': 'abc' }));

    expect(result).toBe(true);
    expect(cls.get<any>(PLATFORM_SCOPE_CLS_KEY)?.adminId.toString()).toBe(adminId);
    expect(cls.get(MFA_VERIFIED_CLS_KEY)).toBe(true);
  });

  it('skips session lookup for @Public() routes (health check)', async () => {
    const sessions = { get: jest.fn(), touch: jest.fn() };
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as unknown as Reflector;
    const guard = new PlatformSessionAuthGuard(sessions as any, new FakeCls() as any, reflector);

    expect(await guard.canActivate(fakeContext())).toBe(true);
    expect(sessions.get).not.toHaveBeenCalled();
  });
});
