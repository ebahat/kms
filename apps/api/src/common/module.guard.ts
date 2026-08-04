import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { Scope, SCOPE_CLS_KEY } from '@kms/data';
import { MODULE_METADATA_KEY, ModuleName } from '@kms/contracts';

/**
 * ADR-0012: a route with no @Module() requirement is always allowed. A route
 * that declares one 404s (never 403, sec §3.2) if the tenant's
 * featureToggles doesn't include it.
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requirement = this.reflector.getAllAndOverride<ModuleName | undefined>(MODULE_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requirement) return true;

    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope) return true; // the auth guard runs first and rejects unauthenticated requests

    if (!scope.featureToggles.includes(requirement)) {
      throw new NotFoundException();
    }
    return true;
  }
}
