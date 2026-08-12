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

/**
 * Phase 2 plan Task 1: a parentId that doesn't resolve inside the caller's
 * tenant (nonexistent, or belonging to another tenant) must never be stored —
 * a dangling parentId breaks ADR-0005's resolver for the whole tenant, not
 * just the one folder (see resolveFolderPermissions's cycle/orphan handling).
 */
export class FolderParentNotFoundError extends Error {
  constructor() {
    super('The specified parent folder does not exist.');
    this.name = 'FolderParentNotFoundError';
  }
}
