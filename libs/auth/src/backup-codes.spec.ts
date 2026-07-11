import { generateBackupCodes, hashBackupCodes, verifyAndFindBackupCode } from './backup-codes';

const PEPPER = 'test-pepper-value';

describe('Backup codes (sec §2, ADR-0004)', () => {
  it('generates 10 unique codes by default, formatted XXXX-XXXX', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('verifies a correct code and returns its index', async () => {
    const codes = generateBackupCodes(3);
    const hashes = await hashBackupCodes(codes, PEPPER);

    const idx = await verifyAndFindBackupCode(hashes, codes[1], PEPPER);
    expect(idx).toBe(1);
  });

  it('is case-insensitive on input (dashes/casing are transcription noise)', async () => {
    const codes = generateBackupCodes(1);
    const hashes = await hashBackupCodes(codes, PEPPER);

    const idx = await verifyAndFindBackupCode(hashes, codes[0].toLowerCase(), PEPPER);
    expect(idx).toBe(0);
  });

  it('returns -1 for a code that matches nothing', async () => {
    const hashes = await hashBackupCodes(generateBackupCodes(2), PEPPER);
    const idx = await verifyAndFindBackupCode(hashes, 'ZZZZ-ZZZZ', PEPPER);
    expect(idx).toBe(-1);
  });
});
