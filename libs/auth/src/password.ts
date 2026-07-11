import * as argon2 from 'argon2';
import { createHmac } from 'crypto';

/**
 * Argon2id floor per sec §2: memory 64 MiB, time 3, parallelism 1.
 * Revisit against OWASP guidance at each annual review (audit plan §4 item 9).
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
};

/**
 * Pepper applied as an HMAC pre-hash (ADR-0004) so pepper rotation re-wraps
 * without forcing user password resets. The pepper itself lives in Secret
 * Manager (ADR-0007) and is injected via env at process start.
 */
function pepperPreHash(password: string, pepper: string): string {
  return createHmac('sha256', pepper).update(password, 'utf8').digest('hex');
}

export async function hashPassword(password: string, pepper: string): Promise<string> {
  return argon2.hash(pepperPreHash(password, pepper), ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string, pepper: string): Promise<boolean> {
  return argon2.verify(hash, pepperPreHash(password, pepper));
}

/**
 * A fixed, precomputed hash used for the "unknown user" branch of login so
 * that known-user and unknown-user paths do the same Argon2id work in the
 * same shape (sec §2 enumeration resistance; timing asserted by test plan §3.2).
 * Real value is generated once at bootstrap and cached — never a live secret.
 */
let dummyHashCache: string | undefined;

export async function getDummyHash(pepper: string): Promise<string> {
  if (!dummyHashCache) {
    dummyHashCache = await hashPassword('dummy-password-for-constant-time-comparison', pepper);
  }
  return dummyHashCache;
}
