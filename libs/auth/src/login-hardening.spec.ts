import { decideLoginHardening } from './login-hardening';

describe('decideLoginHardening (PRD §3, ADR-0004)', () => {
  it('applies no delay/captcha/lockout for the first two failures', () => {
    expect(decideLoginHardening(0)).toEqual({ delayMs: 0, captchaRequired: false, locked: false });
    expect(decideLoginHardening(2)).toEqual({ delayMs: 0, captchaRequired: false, locked: false });
  });

  it('starts progressive delay at the 3rd failure', () => {
    expect(decideLoginHardening(3).delayMs).toBeGreaterThan(0);
    expect(decideLoginHardening(4).delayMs).toBeGreaterThan(decideLoginHardening(3).delayMs);
  });

  it('requires CAPTCHA from the 5th failure', () => {
    expect(decideLoginHardening(4).captchaRequired).toBe(false);
    expect(decideLoginHardening(5).captchaRequired).toBe(true);
  });

  it('locks the account at the 10th failure', () => {
    expect(decideLoginHardening(9).locked).toBe(false);
    expect(decideLoginHardening(10).locked).toBe(true);
  });
});
