import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SCOPE_CLS_KEY } from '@kms/data';
import { SessionAuthGuard, TOS_VERSION_CLS_KEY, MFA_VERIFIED_CLS_KEY } from './session-auth.guard';

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

describe('SessionAuthGuard (ADR-0001 — only writer of tenant context)', () => {
  it('rejects a request with no session cookie at all', async () => {
    const sessions = { get: jest.fn(), touch: jest.fn() };
    const guard = new SessionAuthGuard(sessions as any, new FakeCls() as any, new Reflector());
    await expect(guard.canActivate(fakeContext())).rejects.toThrow(UnauthorizedException);
  });

  it('rejects when the session record is missing or has no tenantId', async () => {
    const sessions = { get: jest.fn().mockResolvedValue(null), touch: jest.fn() };
    const guard = new SessionAuthGuard(sessions as any, new FakeCls() as any, new Reflector());
    await expect(guard.canActivate(fakeContext({ '__Host-kms_sess': 'abc' }))).rejects.toThrow(UnauthorizedException);
  });

  it('populates scope + tosVersion + mfaVerified CLS keys from a valid session', async () => {
    const tenantId = fakeObjectIdHex();
    const userId = fakeObjectIdHex();
    const record = { userId, tenantId, role: 'admin' as const, edition: 'kb' as const, mfaVerified: true, tosVersion: 'v1', createdAt: '', lastSeenAt: '' };
    const sessions = { get: jest.fn().mockResolvedValue(record), touch: jest.fn().mockResolvedValue(undefined) };
    const cls = new FakeCls();
    const guard = new SessionAuthGuard(sessions as any, cls as any, new Reflector());

    const result = await guard.canActivate(fakeContext({ '__Host-kms_sess': 'abc' }));

    expect(result).toBe(true);
    expect(cls.get<any>(SCOPE_CLS_KEY)?.tenantId.toString()).toBe(tenantId);
    expect(cls.get(TOS_VERSION_CLS_KEY)).toBe('v1');
    expect(cls.get(MFA_VERIFIED_CLS_KEY)).toBe(true);
    expect(sessions.touch).toHaveBeenCalled();
  });

  it('populates ownerUserId as the same authenticated user — every tenant-realm session is its own owner, needed by OwnerScopedRepository (conversations/messages, document-chat-rag plan)', async () => {
    const tenantId = fakeObjectIdHex();
    const userId = fakeObjectIdHex();
    const record = { userId, tenantId, role: 'user' as const, edition: 'kb' as const, mfaVerified: true, tosVersion: 'v1', createdAt: '', lastSeenAt: '' };
    const sessions = { get: jest.fn().mockResolvedValue(record), touch: jest.fn().mockResolvedValue(undefined) };
    const cls = new FakeCls();
    const guard = new SessionAuthGuard(sessions as any, cls as any, new Reflector());

    await guard.canActivate(fakeContext({ '__Host-kms_sess': 'abc' }));

    const scope = cls.get<any>(SCOPE_CLS_KEY);
    expect(scope.ownerUserId.toString()).toBe(userId);
    expect(scope.ownerUserId.toString()).toBe(scope.userId.toString());
  });

  it('skips session lookup entirely for @Public() routes', async () => {
    const sessions = { get: jest.fn(), touch: jest.fn() };
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as unknown as Reflector;
    const guard = new SessionAuthGuard(sessions as any, new FakeCls() as any, reflector);

    const result = await guard.canActivate(fakeContext());

    expect(result).toBe(true);
    expect(sessions.get).not.toHaveBeenCalled();
  });
});
