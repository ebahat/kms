import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformMfaGateGuard } from './platform-mfa-gate.guard';
import { MFA_VERIFIED_CLS_KEY } from '../auth/platform-session-auth.guard';

class FakeCls {
  private store = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  set(key: string, value: unknown) {
    this.store.set(key, value);
  }
}

function fakeContext(): ExecutionContext {
  return { getHandler: () => ({}) as any, getClass: () => ({}) as any } as ExecutionContext;
}

describe('PlatformMfaGateGuard (ADR-0004 mandatory TOTP)', () => {
  it('allows through once mfaVerified is true', () => {
    const cls = new FakeCls();
    cls.set(MFA_VERIFIED_CLS_KEY, true);
    expect(new PlatformMfaGateGuard(new Reflector(), cls as any).canActivate(fakeContext())).toBe(true);
  });

  it('rejects the interim pre-TOTP session', () => {
    const cls = new FakeCls();
    cls.set(MFA_VERIFIED_CLS_KEY, false);
    expect(() => new PlatformMfaGateGuard(new Reflector(), cls as any).canActivate(fakeContext())).toThrow(UnauthorizedException);
  });

  it('respects @MfaExempt()', () => {
    const cls = new FakeCls();
    cls.set(MFA_VERIFIED_CLS_KEY, false);
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as unknown as Reflector;
    expect(new PlatformMfaGateGuard(reflector, cls as any).canActivate(fakeContext())).toBe(true);
  });
});
