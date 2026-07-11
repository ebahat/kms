import { randomInt } from 'crypto';
import { hashPassword, verifyPassword } from './password';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — avoids transcription errors

function generateCode(): string {
  let raw = '';
  for (let i = 0; i < 8; i++) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** 10 single-use backup codes at TOTP enrollment (sec §2, ADR-0004). Return the raw codes ONCE — never re-shown. */
export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, generateCode);
}

/** Stored Argon2id-hashed, same as passwords (sec §2). */
export async function hashBackupCodes(codes: string[], pepper: string): Promise<string[]> {
  return Promise.all(codes.map((code) => hashPassword(code, pepper)));
}

/**
 * Single-use: the caller (auth module) must remove the matched hash from the
 * user's stored list immediately after a successful verify (sec §2).
 * Returns the index of the consumed hash, or -1 if the code doesn't match any.
 */
export async function verifyAndFindBackupCode(hashes: string[], code: string, pepper: string): Promise<number> {
  const normalized = code.trim().toUpperCase();
  for (let i = 0; i < hashes.length; i++) {
    if (await verifyPassword(hashes[i], normalized, pepper)) return i;
  }
  return -1;
}
