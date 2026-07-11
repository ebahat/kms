import { authenticator } from 'otplib';
import { generateTotpSecret, totpProvisioningUri, verifyTotp } from './totp';

describe('TOTP (sec §2, ADR-0004)', () => {
  it('generates a base32 secret usable to produce valid tokens', () => {
    const secret = generateTotpSecret();
    const token = authenticator.generate(secret);
    expect(verifyTotp(secret, token)).toBe(true);
  });

  it('rejects a token generated from a different secret', () => {
    const secret = generateTotpSecret();
    const otherToken = authenticator.generate(generateTotpSecret());
    expect(verifyTotp(secret, otherToken)).toBe(false);
  });

  it('rejects malformed tokens without throwing', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, 'not-a-code')).toBe(false);
  });

  it('builds an otpauth:// provisioning URI with the account and issuer', () => {
    const uri = totpProvisioningUri('SECRETSECRET', 'user@tenant.com', 'KMS');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(encodeURIComponent('user@tenant.com'));
  });
});
