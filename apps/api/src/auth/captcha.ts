export interface CaptchaVerifier {
  verify(token: string | undefined): Promise<boolean>;
}

/** No CAPTCHA provider is chosen yet — swap for a real reCAPTCHA/hCaptcha binding at first production deploy (PRD §3). */
export class NoopCaptchaVerifier implements CaptchaVerifier {
  async verify(): Promise<boolean> {
    return true;
  }
}
