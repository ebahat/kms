import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { MFA_EXEMPT_KEY } from '@kms/contracts';
import { MFA_VERIFIED_CLS_KEY } from '../auth/platform-session-auth.guard';

/** Platform-realm equivalent of apps/api's MfaGateGuard — TOTP is mandatory with no exceptions (ADR-0004). */
@Injectable()
export class PlatformMfaGateGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const exempt = this.reflector.getAllAndOverride<boolean | undefined>(MFA_EXEMPT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (exempt) return true;

    const mfaVerified = this.cls.get<boolean | undefined>(MFA_VERIFIED_CLS_KEY);
    if (mfaVerified === undefined) return true; // unauthenticated route

    if (!mfaVerified) throw new UnauthorizedException({ error: 'MFA_REQUIRED' });
    return true;
  }
}
