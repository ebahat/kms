import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { SCOPE_CLS_KEY, Scope } from '@kms/data';

/**
 * Interim role check for tenant-admin-only endpoints (PRD §6/§7). ADR-0005's
 * full folder-permission RBAC resolution is a Phase 2 concern; this guard
 * only distinguishes the two roles the Scope already carries.
 */
@Injectable()
export class AdminOnlyGuard implements CanActivate {
  constructor(private readonly cls: ClsService) {}

  canActivate(): boolean {
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope || scope.role !== 'admin') throw new ForbiddenException();
    return true;
  }
}
