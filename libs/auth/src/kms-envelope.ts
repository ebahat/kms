import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export type EncryptedField = { ciphertext: string; wrappedKey: string; iv: string; authTag: string };

/**
 * Envelope-encryption key provider (sec §7.2, ADR-0004/0007): a KMS key
 * WRAPS a per-field local data key; the data key never leaves this process
 * unwrapped except in memory for the duration of one encrypt/decrypt call.
 * Swappable so production binds to Cloud KMS while tests/dev use a local
 * master key — same pattern as the Argon2id pepper (env-injected secret,
 * not hardcoded).
 */
export interface KmsKeyProvider {
  generateDataKey(): Promise<{ plaintextKey: Buffer; wrappedKey: string }>;
  unwrapDataKey(wrappedKey: string): Promise<Buffer>;
}

/**
 * Dev/test/self-hosted-master-key binding: wraps the 256-bit data key with
 * AES-256-GCM under a single master key from Secret Manager (ADR-0007).
 * The production binding for real Cloud KMS envelope encryption swaps this
 * class for one calling the Cloud KMS `encrypt`/`decrypt` RPCs on the wrapped
 * key bytes — the field-level AES-GCM logic below does not change either way.
 */
export class LocalMasterKeyProvider implements KmsKeyProvider {
  constructor(private readonly masterKeyHex: string) {
    if (Buffer.from(masterKeyHex, 'hex').length !== 32) {
      throw new Error('LocalMasterKeyProvider requires a 32-byte (64 hex char) master key.');
    }
  }

  async generateDataKey(): Promise<{ plaintextKey: Buffer; wrappedKey: string }> {
    const plaintextKey = randomBytes(32);
    return { plaintextKey, wrappedKey: this.wrap(plaintextKey) };
  }

  async unwrapDataKey(wrappedKey: string): Promise<Buffer> {
    const master = Buffer.from(this.masterKeyHex, 'hex');
    const buf = Buffer.from(wrappedKey, 'base64');
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', master, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  private wrap(plaintextKey: Buffer): string {
    const master = Buffer.from(this.masterKeyHex, 'hex');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', master, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintextKey), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }
}

/** Encrypts one field (e.g. a TOTP secret) under a freshly generated data key (sec §7.2). */
export async function encryptField(plaintext: string, kms: KmsKeyProvider): Promise<EncryptedField> {
  const { plaintextKey, wrappedKey } = await kms.generateDataKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', plaintextKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    wrappedKey,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

/** Decrypted only inside the auth module (sec §7.2) — never returned to a controller/DTO. */
export async function decryptField(field: EncryptedField, kms: KmsKeyProvider): Promise<string> {
  const dataKey = await kms.unwrapDataKey(field.wrappedKey);
  const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(field.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(field.authTag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(field.ciphertext, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}
