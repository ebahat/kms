import { createHash } from 'crypto';

export type PwnedRangeFetcher = (shaPrefix: string) => Promise<string>;

/**
 * Breach-list check via haveibeenpwned's k-anonymity range API (sec §2):
 * only the first 5 hex chars of the SHA-1 hash ever leave the process — the
 * full password (and even its full hash) never crosses the network.
 */
export async function isPasswordBreached(password: string, fetchRange: PwnedRangeFetcher = defaultFetchRange): Promise<boolean> {
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const body = await fetchRange(prefix);
  return body
    .split('\n')
    .some((line) => line.split(':')[0].trim() === suffix);
}

async function defaultFetchRange(prefix: string): Promise<string> {
  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { 'Add-Padding': 'true' },
  });
  if (!res.ok) throw new Error(`HIBP range lookup failed: HTTP ${res.status}`);
  return res.text();
}
