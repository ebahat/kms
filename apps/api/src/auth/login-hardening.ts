export type LoginHardeningDecision = {
  delayMs: number;
  captchaRequired: boolean;
  locked: boolean;
};

const DELAY_START_THRESHOLD = 3;
const CAPTCHA_THRESHOLD = 5;
const LOCKOUT_THRESHOLD = 10;
const BASE_DELAY_MS = 1000;

/** Progressive delay after 3 failures, CAPTCHA from the 5th, lockout at 10 with admin unlock (PRD §3, ADR-0004). */
export function decideLoginHardening(failureCount: number): LoginHardeningDecision {
  return {
    delayMs: failureCount >= DELAY_START_THRESHOLD ? BASE_DELAY_MS * (failureCount - DELAY_START_THRESHOLD + 1) : 0,
    captchaRequired: failureCount >= CAPTCHA_THRESHOLD,
    locked: failureCount >= LOCKOUT_THRESHOLD,
  };
}
