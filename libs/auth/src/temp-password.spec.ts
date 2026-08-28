import { generateTempPassword } from './temp-password';

describe('generateTempPassword', () => {
  it('generates a password well above the 12-char minimum (sec §2)', () => {
    expect(generateTempPassword().length).toBeGreaterThanOrEqual(12);
  });

  it('generates a different value on each call', () => {
    expect(generateTempPassword()).not.toBe(generateTempPassword());
  });
});
