import { SetMetadata } from '@nestjs/common';

/**
 * Bumped whenever the Terms of Service / Privacy Policy changes; every user
 * must re-accept before further API access (PRD §6). A real deployment reads
 * this from config, not a compiled constant — kept as a constant for MVP
 * since there is exactly one version in the codebase's lifetime so far.
 */
export const CURRENT_TOS_VERSION = '2026-07-01';

export const TOS_EXEMPT_KEY = 'kms:tos-exempt' as const;

/** Routes reachable before ToS acceptance: login, TOTP challenge, the acceptance endpoint itself, logout. */
export const TosExempt = () => SetMetadata(TOS_EXEMPT_KEY, true);
