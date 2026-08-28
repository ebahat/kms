import { randomBytes } from 'crypto';

/** Shown-once temp password for admin-created accounts (sec §2 — well above the 12-char minimum). */
export function generateTempPassword(): string {
  return randomBytes(16).toString('base64url');
}
