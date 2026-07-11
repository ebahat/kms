import { createResetToken, isResetTokenValid } from './password-reset';

describe('Password reset tokens (sec §2)', () => {
  it('validates the matching raw token against its stored hash', () => {
    const { rawToken, tokenHash, expiresAt } = createResetToken();
    expect(isResetTokenValid(rawToken, tokenHash, expiresAt)).toBe(true);
  });

  it('rejects a token that does not match the stored hash', () => {
    const { tokenHash, expiresAt } = createResetToken();
    expect(isResetTokenValid('wrong-token', tokenHash, expiresAt)).toBe(false);
  });

  it('rejects an expired token even with a matching hash', () => {
    const { rawToken, tokenHash } = createResetToken();
    const expired = new Date(Date.now() - 1000);
    expect(isResetTokenValid(rawToken, tokenHash, expired)).toBe(false);
  });

  it('rejects when there is no stored token at all', () => {
    expect(isResetTokenValid('anything', undefined, undefined)).toBe(false);
  });

  it('never persists the raw token as the hash', () => {
    const { rawToken, tokenHash } = createResetToken();
    expect(tokenHash).not.toBe(rawToken);
  });
});
