import { createHash } from 'crypto';
import { isPasswordBreached } from './breach-check';

function sha1(input: string): string {
  return createHash('sha1').update(input, 'utf8').digest('hex').toUpperCase();
}

describe('Breach-list check (sec §2, k-anonymity)', () => {
  it('reports a breached password when its suffix is in the range response', async () => {
    const password = 'password123';
    const full = sha1(password);
    const suffix = full.slice(5);
    const fetchRange = jest.fn().mockResolvedValue(`${suffix}:12345\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1`);

    const result = await isPasswordBreached(password, fetchRange);

    expect(result).toBe(true);
    expect(fetchRange).toHaveBeenCalledWith(full.slice(0, 5));
  });

  it('reports not-breached when the suffix is absent from the range response', async () => {
    const fetchRange = jest.fn().mockResolvedValue('DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEA:1');
    const result = await isPasswordBreached('a-very-unique-passphrase-98765', fetchRange);
    expect(result).toBe(false);
  });

  it('only ever sends a 5-char prefix, never the full hash or password', async () => {
    const fetchRange = jest.fn().mockResolvedValue('');
    await isPasswordBreached('correct horse battery staple', fetchRange);
    const sentPrefix = fetchRange.mock.calls[0][0];
    expect(sentPrefix).toHaveLength(5);
  });
});
