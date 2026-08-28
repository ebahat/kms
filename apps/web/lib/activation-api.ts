import { tenantApi } from './api';

/**
 * Public (unauthenticated) invite-activation endpoints — /auth/activate/* (user-management plan,
 * 2026-08-24). `check` is a POST, not a GET, deliberately — a GET would put the raw single-use
 * token in the URL (browser history, Referer header on any same-origin follow-up request), even
 * though the response itself carries no data (security review finding, 2026-08-24).
 */
export const activationApi = {
  check: (email: string, token: string) => tenantApi.post<{ valid: boolean }>('/auth/activate/check', { email, token }),
  confirm: (email: string, token: string, newPassword: string) =>
    tenantApi.post<{ ok: true }>('/auth/activate/confirm', { email, token, newPassword }),
};
