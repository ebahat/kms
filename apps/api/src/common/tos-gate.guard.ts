import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { CURRENT_TOS_VERSION, TOS_EXEMPT_KEY } from '@kms/contracts';
import { TOS_VERSION_CLS_KEY } from '../auth/session-auth.guard';

/** 451 Unavailable For Legal Reasons — distinguishable from 401/403 so the frontend routes to the acceptance screen, not a login retry. */
export class TosAcceptanceRequiredException extends HttpException {
  constructor() {
    super({ error: 'TOS_ACCEPTANCE_REQUIRED', currentVersion: CURRENT_TOS_VERSION }, 451);
  }
}

/**
 * Forces the ToS/Privacy acceptance interstitial before any further API
 * access when the session's accepted version doesn't match the current one
 * (PRD §6, ADR-0004 "session.tosVersion checked against the current version").
 */
@Injectable()
export class TosGateGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const exempt = this.reflector.getAllAndOverride<boolean | undefined>(TOS_EXEMPT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (exempt) return true;

    const tosVersion = this.cls.get<string | undefined>(TOS_VERSION_CLS_KEY);
    if (tosVersion === undefined) return true; // unauthenticated route, or platform realm (ToS applies to tenant users only)

    if (tosVersion !== CURRENT_TOS_VERSION) {
      throw new TosAcceptanceRequiredException();
    }
    return true;
  }
}
