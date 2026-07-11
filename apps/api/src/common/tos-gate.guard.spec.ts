import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CURRENT_TOS_VERSION } from '@kms/contracts';
import { TosGateGuard, TosAcceptanceRequiredException } from './tos-gate.guard';
import { TOS_VERSION_CLS_KEY } from '../auth/session-auth.guard';

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

describe('TosGateGuard (PRD §6, ADR-0004)', () => {
  it('allows the request through when the session tosVersion matches current', () => {
    const cls = new FakeCls();
    cls.set(TOS_VERSION_CLS_KEY, CURRENT_TOS_VERSION);
    const guard = new TosGateGuard(new Reflector(), cls as any);

    expect(guard.canActivate(fakeContext())).toBe(true);
  });

  it('throws TosAcceptanceRequiredException (451) when tosVersion is stale', () => {
    const cls = new FakeCls();
    cls.set(TOS_VERSION_CLS_KEY, '2020-01-01');
    const guard = new TosGateGuard(new Reflector(), cls as any);

    expect(() => guard.canActivate(fakeContext())).toThrow(TosAcceptanceRequiredException);
    try {
      guard.canActivate(fakeContext());
    } catch (err) {
      expect((err as TosAcceptanceRequiredException).getStatus()).toBe(451);
    }
  });

  it('passes through when no tosVersion is set at all (unauthenticated route or platform realm)', () => {
    const cls = new FakeCls(); // nothing set
    const guard = new TosGateGuard(new Reflector(), cls as any);

    expect(guard.canActivate(fakeContext())).toBe(true);
  });

  it('respects @TosExempt() even with a stale tosVersion', () => {
    const cls = new FakeCls();
    cls.set(TOS_VERSION_CLS_KEY, '2020-01-01');
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as unknown as Reflector;
    const guard = new TosGateGuard(reflector, cls as any);

    expect(guard.canActivate(fakeContext())).toBe(true);
  });
});
