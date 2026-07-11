/** Thrown when a repository operation runs with no authenticated scope in CLS — fail closed (ADR-0001). */
export class MissingScopeError extends Error {
  constructor(modelName: string) {
    super(`MissingScopeError: no scope in CLS for model "${modelName}" — refusing to query unscoped`);
    this.name = 'MissingScopeError';
  }
}

/** Thrown by the backstop plugin when a query reaches a tenant-owned model without the expected tenant filter. */
export class UnscopedQueryError extends Error {
  constructor(modelName: string, operation: string) {
    super(`UnscopedQueryError: "${operation}" on "${modelName}" was missing the required tenantId filter`);
    this.name = 'UnscopedQueryError';
  }
}
