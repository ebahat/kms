import { CanActivate, ExecutionContext, Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { scopeFromIds, SCOPE_CLS_KEY } from '@kms/data';
import { SessionService, REALM_COOKIE_NAME } from '@kms/auth';

export const SESSION_SERVICE = 'SESSION_SERVICE' as const;

/**
 * The ONLY writer of tenant context in the HTTP path (ADR-0001). Reads the
 * tenant-realm session cookie, looks it up in redis-app (never trusts
 * request input for identity), and populates the CLS scope every
 * downstream repository call reads.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    private readonly cls: ClsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
    });
    this.cls.set(SCOPE_CLS_KEY, scope);
    return true;
  }
}
