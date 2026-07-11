import { hashPassword, verifyPassword, getDummyHash } from './password';

describe('password hashing (Argon2id, ADR-0004)', () => {
  const pepper = 'test-pepper-not-a-real-secret';

  it('hashes and verifies a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple', pepper);
    await expect(verifyPassword(hash, 'correct horse battery staple', pepper)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple', pepper);
    await expect(verifyPassword(hash, 'wrong password', pepper)).resolves.toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const a = await hashPassword('same password', pepper);
    const b = await hashPassword('same password', pepper);
    expect(a).not.toEqual(b);
  });

  it('caches the dummy hash for constant-time unknown-user comparisons', async () => {
    const a = await getDummyHash(pepper);
    const b = await getDummyHash(pepper);
    expect(a).toEqual(b);
  });
});
