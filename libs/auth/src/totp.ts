import { authenticator } from 'otplib';

/**
 * TOTP mandatory for all logins (sec §2, ADR-0004): ±1 step tolerance,
 * rate-limited 5/5 min (enforced by the caller via rate-limiter.ts — this
 * module only does the cryptographic check). Secrets are never persisted
 * in plaintext — see kms-envelope.ts.
 */
authenticator.options = { window: 1 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpProvisioningUri(secret: string, accountEmail: string, issuer = 'KMS'): string {
  return authenticator.keyuri(accountEmail, issuer, secret);
}

export function verifyTotp(secret: string, token: string): boolean {
  try {
    return authenticator.check(token, secret);
  } catch {
    return false; // malformed token — treat as invalid, never throw into the auth path
  }
}
