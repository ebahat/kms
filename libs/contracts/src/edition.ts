import { SetMetadata } from '@nestjs/common';

export type EditionRequirement = 'kb' | 'ocr' | 'both';

export const EDITION_METADATA_KEY = 'kms:edition' as const;
export const EDITION_EXEMPT_KEY = 'kms:edition-exempt' as const;

/**
 * Declares which edition(s) a controller/route serves (ADR-0009 G2).
 * The EditionGuard (apps/api/src/common/edition.guard.ts) reads this and
 * returns 404 — never 403 — for a mismatched tenant edition (sec §3.2 consistency).
 */
export const Edition = (requirement: EditionRequirement) => SetMetadata(EDITION_METADATA_KEY, requirement);

/**
 * Marks infra-only routes (health checks, etc.) that carry no tenant data
 * and are intentionally excluded from edition gating. The bootstrap
 * assertion requires every controller to carry EITHER @Edition() or
 * @EditionExempt() so a new route cannot silently skip gating (ADR-0009).
 */
export const EditionExempt = () => SetMetadata(EDITION_EXEMPT_KEY, true);
