import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const RESET_TOKEN_TTL_MS = 30 * 60_000; // ≤30 min (sec §2)

export type PasswordResetToken = { rawToken: string; tokenHash: string; expiresAt: Date };

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** 128-bit single-use token; only the SHA-256 hash is persisted (sec §2) — the raw value goes in the email link only. */
export function createResetToken(): PasswordResetToken {
  const rawToken = randomBytes(16).toString('base64url');
  return { rawToken, tokenHash: sha256(rawToken), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) };
}

export function isResetTokenValid(rawToken: string, storedHash: string | undefined, expiresAt: Date | undefined): boolean {
  if (!storedHash || !expiresAt) return false;
  if (Date.now() > expiresAt.getTime()) return false;
  const candidate = Buffer.from(sha256(rawToken), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}
