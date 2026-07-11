import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'kms:public' as const;

/**
 * Routes reachable with NO session at all: login, password-reset request/confirm,
 * health. SessionAuthGuard checks this FIRST and skips cookie/session lookup
 * entirely — everything else in the app requires an authenticated session
 * (ADR-0001 "the only writer of tenant context").
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
