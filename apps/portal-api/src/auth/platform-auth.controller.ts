import { Body, Controller, HttpCode, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { LoginRequestSchema, TotpVerifyRequestSchema, Public, MfaExempt } from '@kms/contracts';
import {
  hashPassword,
  verifyPassword,
  getDummyHash,
  SessionService,
  REALM_COOKIE_NAME,
  verifyTotp,
  encryptField,
  decryptField,
  KmsKeyProvider,
  generateTotpSecret,
  totpProvisioningUri,
  decideLoginHardening,
  RateLimiter,
  CaptchaVerifier,
  SecurityAlertSink,
} from '@kms/auth';
import { PLATFORM_SCOPE_CLS_KEY, PlatformScope, PlatformAdminsRepository } from '@kms/data';
import { SESSION_SERVICE } from './platform-session-auth.guard';
import { setSessionCookie, clearSessionCookie } from './cookie';
import { PASSWORD_PEPPER, KMS_KEY_PROVIDER, RATE_LIMITER, CAPTCHA_VERIFIER, SECURITY_ALERT_SINK } from './auth.providers';

const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;
const TOTP_RATE_WINDOW_SECONDS = 5 * 60;
const TOTP_MAX_ATTEMPTS = 5;

/**
 * Platform-admin realm login handshake (ADR-0004) — same two-step shape as
 * the tenant realm (apps/api) but no ToS/edition concept and NO backup-code
 * self-recovery: a lost TOTP device can only be cleared by a second admin
 * (see mfa-reset.controller.ts, two-person control).
 */
@Controller('auth')
export class PlatformAuthController {
  constructor(
    private readonly admins: PlatformAdminsRepository,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    private readonly cls: ClsService,
    @Inject(PASSWORD_PEPPER) private readonly pepper: string,
    @Inject(KMS_KEY_PROVIDER) private readonly kms: KmsKeyProvider,
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiter,
    @Inject(CAPTCHA_VERIFIER) private readonly captcha: CaptchaVerifier,
    @Inject(SECURITY_ALERT_SINK) private readonly alerts: SecurityAlertSink,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { email, password, captchaToken } = LoginRequestSchema.parse(body);
    const normalizedEmail = email.toLowerCase().trim();
    const failureKey = `padm-login-fail:${normalizedEmail}`;

    const failureCount = await this.rateLimiter.count(failureKey);
    const hardening = decideLoginHardening(failureCount);
    if (hardening.delayMs > 0) await sleep(hardening.delayMs);
    if (hardening.captchaRequired && !(await this.captcha.verify(captchaToken))) {
      throw new UnauthorizedException({ error: 'CAPTCHA_REQUIRED' });
    }

    const admin = await this.admins.findByEmail(normalizedEmail);
    const usable = !!admin && admin.status === 'active';

    const passwordOk = usable
      ? await verifyPassword(admin!.passwordHash, password, this.pepper)
      : await verifyPassword(await getDummyHash(this.pepper), password, this.pepper);

    if (!usable || !passwordOk) {
      const newCount = await this.rateLimiter.increment(failureKey, LOGIN_FAILURE_WINDOW_SECONDS);
      const newHardening = decideLoginHardening(newCount);
      if (newHardening.captchaRequired) this.alerts.failedLoginBurst(normalizedEmail, newCount);
      if (admin && newHardening.locked) {
        await this.admins.updateOne(admin._id, { $set: { status: 'inactive' } });
        this.alerts.lockoutTriggered(normalizedEmail);
      }
      throw new UnauthorizedException({ error: 'INVALID_CREDENTIALS' }); // identical body regardless of cause (sec §2)
    }

    await this.rateLimiter.reset(failureKey);

    const sessionId = await this.sessions.create('platform', {
      userId: admin!._id.toString(),
      role: 'admin',
      mfaVerified: false,
    });
    setSessionCookie(res, 'platform', sessionId);

    return { mfaRequired: true, mfaEnrolled: admin!.mfaEnabled };
  }

  /** First-login TOTP setup — no backup codes in this realm (ADR-0004: no self-service MFA recovery). */
  @MfaExempt()
  @Post('totp/enroll')
  @HttpCode(200)
  async enrollTotp() {
    const scope = this.cls.get<PlatformScope>(PLATFORM_SCOPE_CLS_KEY);
    if (!scope) throw new UnauthorizedException();

    const admin = await this.admins.findById(scope.adminId);
    if (!admin) throw new UnauthorizedException();

    const secret = generateTotpSecret();
    const envelope = await encryptField(secret, this.kms);
    await this.admins.updateOne(admin._id, { $set: { totpSecretEnvelope: envelope, mfaEnabled: true } });

    return { provisioningUri: totpProvisioningUri(secret, admin.email, 'KMS Admin'), secret };
  }

  @MfaExempt()
  @Post('totp')
  @HttpCode(200)
  async verifyTotpCode(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { code } = TotpVerifyRequestSchema.parse(body);
    const scope = this.cls.get<PlatformScope>(PLATFORM_SCOPE_CLS_KEY);
    if (!scope) throw new UnauthorizedException();

    const rateLimitKey = `padm-totp-fail:${scope.adminId.toString()}`;
    const attempts = await this.rateLimiter.increment(rateLimitKey, TOTP_RATE_WINDOW_SECONDS);
    if (attempts > TOTP_MAX_ATTEMPTS) throw new UnauthorizedException({ error: 'TOTP_RATE_LIMITED' });

    const admin = await this.admins.findById(scope.adminId);
    if (!admin || !admin.totpSecretEnvelope) throw new UnauthorizedException();

    const secret = await decryptField(admin.totpSecretEnvelope, this.kms);
    if (!verifyTotp(secret, code)) throw new UnauthorizedException({ error: 'INVALID_TOTP' });

    await this.rateLimiter.reset(rateLimitKey);

    const sessionId = req.cookies?.[REALM_COOKIE_NAME.platform];
    const record = await this.sessions.get('platform', sessionId);
    if (!record) throw new UnauthorizedException();

    const newSessionId = await this.sessions.rotate('platform', sessionId, { ...record, mfaVerified: true });
    setSessionCookie(res, 'platform', newSessionId);

    return { ok: true };
  }

  @MfaExempt()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sessionId = req.cookies?.[REALM_COOKIE_NAME.platform];
    const scope = this.cls.get<PlatformScope>(PLATFORM_SCOPE_CLS_KEY);
    if (sessionId && scope) await this.sessions.revoke('platform', sessionId, scope.adminId.toString());
    clearSessionCookie(res, 'platform');
    return { ok: true };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
