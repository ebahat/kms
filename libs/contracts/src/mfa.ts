import { SetMetadata } from '@nestjs/common';

export const MFA_EXEMPT_KEY = 'kms:mfa-exempt' as const;

/**
 * Routes reachable from the "interim, unauthenticated state" between password
 * verification and TOTP verification (ADR-0004 sequence diagram): the TOTP
 * challenge endpoint itself, and logout (a user mid-MFA-challenge must still
 * be able to abandon and log out). Everything else requires session.mfaVerified.
 */
export const MfaExempt = () => SetMetadata(MFA_EXEMPT_KEY, true);
