import { CanActivate, ExecutionContext, Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { scopeFromIds, SCOPE_CLS_KEY } from '@kms/data';
import { SessionService, REALM_COOKIE_NAME } from '@kms/auth';
import { PUBLIC_KEY } from '@kms/contracts';

export const SESSION_SERVICE = 'SESSION_SERVICE' as const;
export const TOS_VERSION_CLS_KEY = 'tosVersion' as const;
export const MFA_VERIFIED_CLS_KEY = 'mfaVerified' as const;

/**
 * The ONLY writer of tenant context in the HTTP path (ADR-0001). Reads the
 * tenant-realm session cookie, looks it up in redis-app (never trusts
 * request input for identity), and populates the CLS scope every
 * downstream repository call reads. Routes marked @Public() (login,
 * password-reset request/confirm, health) skip this entirely — there is no
 * session yet by definition.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
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
    const sessionId = req.cookies?.[REALM_COOKIE_NAME.tenant];
    if (!sessionId) throw new UnauthorizedException();

    const record = await this.sessions.get('tenant', sessionId);
    if (!record || !record.tenantId) throw new UnauthorizedException();

    await this.sessions.touch('tenant', sessionId, record);

    const scope = scopeFromIds({
      userId: record.userId,
      tenantId: record.tenantId,
      role: record.role,
      edition: record.edition ?? 'kb',
      featureToggles: record.featureToggles ?? [],
    });
    this.cls.set(SCOPE_CLS_KEY, scope);
    this.cls.set(TOS_VERSION_CLS_KEY, record.tosVersion);
    this.cls.set(MFA_VERIFIED_CLS_KEY, record.mfaVerified);
    return true;
  }
}
