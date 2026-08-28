import { createInviteToken, isInviteTokenValid } from './invite';

describe('Invite-activation tokens (user-management plan, 2026-08-24)', () => {
  it('validates the matching raw token against its stored hash', () => {
    const { rawToken, tokenHash, expiresAt } = createInviteToken();
    expect(isInviteTokenValid(rawToken, tokenHash, expiresAt)).toBe(true);
  });

  it('rejects a token that does not match the stored hash', () => {
    const { tokenHash, expiresAt } = createInviteToken();
    expect(isInviteTokenValid('wrong-token', tokenHash, expiresAt)).toBe(false);
  });

  it('sets a ~24h expiry, not the 30-minute reset-token TTL', () => {
    const { expiresAt } = createInviteToken();
    const hoursUntilExpiry = (expiresAt.getTime() - Date.now()) / (60 * 60_000);
    expect(hoursUntilExpiry).toBeGreaterThan(23.9);
    expect(hoursUntilExpiry).toBeLessThanOrEqual(24);
  });

  it('rejects an expired token even with a matching hash', () => {
    const { rawToken, tokenHash } = createInviteToken();
    const expired = new Date(Date.now() - 1000);
    expect(isInviteTokenValid(rawToken, tokenHash, expired)).toBe(false);
  });

  it('rejects when there is no stored token at all', () => {
    expect(isInviteTokenValid('anything', undefined, undefined)).toBe(false);
  });

  it('never persists the raw token as the hash', () => {
    const { rawToken, tokenHash } = createInviteToken();
    expect(tokenHash).not.toBe(rawToken);
  });
});
