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

/** ADR-0005 cardinality bound — friendly rejection instead of an unbounded folders collection. */
export class FolderLimitExceededError extends Error {
  constructor(limit: number) {
    super(`This tenant already has ${limit} folders, which is the maximum supported. Delete unused folders before creating more.`);
    this.name = 'FolderLimitExceededError';
  }
}

/** PRD §8 — max folder nesting depth. */
export class FolderDepthExceededError extends Error {
  constructor(maxDepth: number) {
    super(`Folders can be nested at most ${maxDepth} levels deep.`);
    this.name = 'FolderDepthExceededError';
  }
}
