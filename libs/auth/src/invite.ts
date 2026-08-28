import { createToken, isTokenValid, PasswordResetToken } from './password-reset';

const INVITE_TOKEN_TTL_MS = 24 * 60 * 60_000; // 24h (user-management plan, 2026-08-24)

export type InviteToken = PasswordResetToken;

/**
 * Same generation/validation as password-reset tokens (128-bit, SHA-256-hashed, single-use) but
 * with its own 24h TTL and — critically — stored in User.inviteTokenHash/inviteExpiresAt, separate
 * fields from passwordResetTokenHash/passwordResetExpiresAt. An admin-issued invite and a
 * user-initiated reset must never collide on the same fields.
 */
export function createInviteToken(): InviteToken {
  return createToken(INVITE_TOKEN_TTL_MS);
}

export const isInviteTokenValid = isTokenValid;
