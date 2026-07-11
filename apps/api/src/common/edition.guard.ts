import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { Scope, SCOPE_CLS_KEY } from '@kms/data';
import { EDITION_METADATA_KEY, EditionRequirement } from '@kms/contracts';

/**
 * ADR-0009 G2: out-of-edition routes return 404, matching the sec §3.2
 * "out-of-tenant is 404, not 403" convention — an OCR-only tenant hitting a
 * KB-only route should see the same thing as a route that doesn't exist.
 */
@Injectable()
export class EditionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requirement = this.reflector.getAllAndOverride<EditionRequirement | undefined>(EDITION_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requirement || requirement === 'both') return true;

    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope) return true; // the auth guard runs first and rejects unauthenticated requests

    if (scope.edition !== requirement) {
      throw new NotFoundException();
    }
    return true;
  }
}
