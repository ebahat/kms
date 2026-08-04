import { SetMetadata } from '@nestjs/common';

export type ModuleName = 'governance' | 'kanban' | 'calendar' | 'llm';

export const MODULE_METADATA_KEY = 'kms:module' as const;

/**
 * Declares which opt-in module a route requires (ADR-0012). Unlike @Edition,
 * this is optional — most routes need no module at all. ModuleGuard
 * (apps/api/src/common/module.guard.ts) reads this and returns 404 — never
 * 403 — when the tenant's featureToggles doesn't include it.
 */
export const Module = (name: ModuleName) => SetMetadata(MODULE_METADATA_KEY, name);
