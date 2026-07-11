import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MfaGateGuard } from './mfa-gate.guard';
import { MFA_VERIFIED_CLS_KEY } from '../auth/session-auth.guard';

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
  return {
    getHandler: () => ({}) as any,
    getClass: () => ({}) as any,
  } as ExecutionContext;
}

describe('MfaGateGuard (ADR-0004 interim pre-TOTP session)', () => {
  it('allows the request through once mfaVerified is true', () => {
    const cls = new FakeCls();
    cls.set(MFA_VERIFIED_CLS_KEY, true);
    const guard = new MfaGateGuard(new Reflector(), cls as any);
    expect(guard.canActivate(fakeContext())).toBe(true);
  });

  it('throws when mfaVerified is false (interim session, TOTP not yet cleared)', () => {
    const cls = new FakeCls();
    cls.set(MFA_VERIFIED_CLS_KEY, false);
    const guard = new MfaGateGuard(new Reflector(), cls as any);
    expect(() => guard.canActivate(fakeContext())).toThrow(UnauthorizedException);
  });

  it('passes through when no mfaVerified flag is set at all (unauthenticated route)', () => {
    const cls = new FakeCls();
    const guard = new MfaGateGuard(new Reflector(), cls as any);
    expect(guard.canActivate(fakeContext())).toBe(true);
  });

  it('respects @MfaExempt() even mid-challenge', () => {
    const cls = new FakeCls();
    cls.set(MFA_VERIFIED_CLS_KEY, false);
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as unknown as Reflector;
    const guard = new MfaGateGuard(reflector, cls as any);
    expect(guard.canActivate(fakeContext())).toBe(true);
  });
});
