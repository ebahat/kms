import { CanActivate, ExecutionContext, Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { platformScopeFromId, PLATFORM_SCOPE_CLS_KEY } from '@kms/data';
import { SessionService, REALM_COOKIE_NAME } from '@kms/auth';
import { PUBLIC_KEY } from '@kms/contracts';

export const SESSION_SERVICE = 'SESSION_SERVICE' as const;
export const MFA_VERIFIED_CLS_KEY = 'mfaVerified' as const;

/**
 * Platform-realm equivalent of apps/api's SessionAuthGuard (ADR-0004): reads
 * the __Host-kms_padm cookie, looks it up under the 'platform' realm prefix
 * (never 'tenant' — a tenant cookie is structurally meaningless here), and
 * populates PlatformScope. No tenantId/edition exist in this realm at all.
 */
@Injectable()
export class PlatformSessionAuthGuard implements CanActivate {
  constructor(
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    private readonly cls: ClsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const sessionId = req.cookies?.[REALM_COOKIE_NAME.platform];
    if (!sessionId) throw new UnauthorizedException();

    const record = await this.sessions.get('platform', sessionId);
    if (!record) throw new UnauthorizedException();

    await this.sessions.touch('platform', sessionId, record);

    this.cls.set(PLATFORM_SCOPE_CLS_KEY, platformScopeFromId(record.userId));
    this.cls.set(MFA_VERIFIED_CLS_KEY, record.mfaVerified);
    return true;
  }
}
