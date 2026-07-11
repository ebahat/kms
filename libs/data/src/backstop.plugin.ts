import { Schema } from 'mongoose';
import { ClsServiceManager } from 'nestjs-cls';
import { Scope, SCOPE_CLS_KEY } from './scope';
import { UnscopedQueryError } from './errors';
import { SystemScope } from './system-scope';

const QUERY_HOOKS = ['find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'count', 'countDocuments', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany'] as const;

/**
 * Fail-closed runtime tripwire (ADR-0001 Option C). NEVER injects the tenant
 * filter — that stays visible in ScopedRepository. This plugin only THROWS
 * when a query reaches a tenant-owned model without the expected tenantId,
 * catching bypasses that dodge the lint rule (raw model injection, a new
 * unaudited query path, etc.).
 *
 * Register on every tenant-owned schema:
 *   schema.plugin(tenantScopeBackstopPlugin);
 */
export function tenantScopeBackstopPlugin(schema: Schema) {
  for (const hook of QUERY_HOOKS) {
    schema.pre(hook as any, function (this: any) {
      if (isSystemScopeActive()) return; // audited escape hatch (SystemScope.run)
      const filter = this.getQuery ? this.getQuery() : this._conditions;
      assertTenantFilter(filter, this.model?.modelName ?? 'unknown', hook);
    });
  }

  schema.pre('aggregate', function (this: any) {
    if (isSystemScopeActive()) return;
    const pipeline = this.pipeline();
    const first = pipeline[0];
    const tenantId = getCurrentScope()?.tenantId;
    if (!first?.$match || String(first.$match.tenantId) !== String(tenantId)) {
      throw new UnscopedQueryError(this._model?.modelName ?? 'unknown', 'aggregate');
    }
  });

  schema.pre('save', function (this: any) {
    if (isSystemScopeActive()) return;
    const scope = getCurrentScope();
    if (!scope) throw new UnscopedQueryError(this.constructor.modelName, 'save');
    if (this.isNew && this.tenantId === undefined) {
      this.tenantId = scope.tenantId;
    }
  });
}

function assertTenantFilter(filter: Record<string, unknown>, modelName: string, operation: string) {
  const scope = getCurrentScope();
  if (!scope) throw new UnscopedQueryError(modelName, operation);
  if (String(filter?.tenantId ?? '') !== String(scope.tenantId)) {
    throw new UnscopedQueryError(modelName, operation);
  }
}

function getCurrentScope(): Scope | undefined {
  try {
    return ClsServiceManager.getClsService().get<Scope>(SCOPE_CLS_KEY);
  } catch {
    return undefined; // no active CLS context (e.g. outside a request/job) — caller must use SystemScope.run
  }
}

function isSystemScopeActive(): boolean {
  try {
    return SystemScope.isActive(ClsServiceManager.getClsService());
  } catch {
    return false;
  }
}
