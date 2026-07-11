import { randomBytes } from 'crypto';
import { encryptField, decryptField, LocalMasterKeyProvider } from './kms-envelope';

const MASTER_KEY_HEX = randomBytes(32).toString('hex');

describe('KMS envelope encryption (sec §7.2, ADR-0004/0007)', () => {
  it('round-trips plaintext through encrypt/decrypt', async () => {
    const kms = new LocalMasterKeyProvider(MASTER_KEY_HEX);
    const field = await encryptField('otpauth-secret-value', kms);
    const plaintext = await decryptField(field, kms);
    expect(plaintext).toBe('otpauth-secret-value');
  });

  it('never stores the plaintext in the envelope', async () => {
    const kms = new LocalMasterKeyProvider(MASTER_KEY_HEX);
    const field = await encryptField('super-secret-totp-seed', kms);
    expect(field.ciphertext).not.toContain('super-secret-totp-seed');
    expect(JSON.stringify(field)).not.toContain('super-secret-totp-seed');
  });

  it('uses a fresh data key per field (wrappedKey differs across calls)', async () => {
    const kms = new LocalMasterKeyProvider(MASTER_KEY_HEX);
    const a = await encryptField('value', kms);
    const b = await encryptField('value', kms);
    expect(a.wrappedKey).not.toBe(b.wrappedKey);
    expect(a.ciphertext).not.toBe(b.ciphertext); // different IV/key even for identical plaintext
  });

  it('fails to decrypt under a different master key', async () => {
    const kms1 = new LocalMasterKeyProvider(MASTER_KEY_HEX);
    const kms2 = new LocalMasterKeyProvider(randomBytes(32).toString('hex'));
    const field = await encryptField('value', kms1);
    await expect(decryptField(field, kms2)).rejects.toThrow();
  });

  it('rejects a master key that is not exactly 32 bytes', () => {
    expect(() => new LocalMasterKeyProvider('too-short')).toThrow();
  });
});
