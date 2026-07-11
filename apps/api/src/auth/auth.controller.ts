import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import {
  LoginRequestSchema,
  TotpVerifyRequestSchema,
  PasswordResetRequestSchema,
  PasswordResetConfirmSchema,
  TosAcceptRequestSchema,
  Public,
  MfaExempt,
  TosExempt,
  EditionExempt,
} from '@kms/contracts';
import {
  hashPassword,
  verifyPassword,
  getDummyHash,
  SessionService,
  REALM_COOKIE_NAME,
  verifyTotp,
  decryptField,
  KmsKeyProvider,
  verifyAndFindBackupCode,
  createResetToken,
  isResetTokenValid,
  isPasswordBreached,
} from '@kms/auth';
import { scopeFromIds, SCOPE_CLS_KEY, Scope, TenantsRepository, UsersRepository } from '@kms/data';
import { SESSION_SERVICE } from './session-auth.guard';
import { setSessionCookie, clearSessionCookie } from './cookie';
import { decideLoginHardening } from './login-hardening';
import { PASSWORD_PEPPER, KMS_KEY_PROVIDER, RATE_LIMITER, CAPTCHA_VERIFIER, SECURITY_ALERT_SINK } from './auth.providers';
import { RateLimiter } from '@kms/auth';
import { CaptchaVerifier } from './captcha';
import { SecurityAlertSink } from './security-alerts';

const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;
const TOTP_RATE_WINDOW_SECONDS = 5 * 60;
const TOTP_MAX_ATTEMPTS = 5;

/**
 * The auth handshake (ADR-0004): login -> TOTP challenge -> full session.
 * Every route here is either @Public() (no session exists yet) or
 * @MfaExempt()/@TosExempt() (session exists but hasn't cleared the gate this
 * endpoint itself is responsible for clearing).
 */
@Controller('auth')
@EditionExempt() // edition-agnostic: identity is checked before edition-specific features are reachable
export class AuthController {
  constructor(
    private readonly users: UsersRepository,
    private readonly tenants: TenantsRepository,
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
    const failureKey = `login-fail:${normalizedEmail}`;

    const failureCount = await this.rateLimiter.count(failureKey);
    const hardening = decideLoginHardening(failureCount);
    if (hardening.delayMs > 0) await sleep(hardening.delayMs);
    if (hardening.captchaRequired && !(await this.captcha.verify(captchaToken))) {
      throw new UnauthorizedException({ error: 'CAPTCHA_REQUIRED' });
    }

    const user = await this.users.findByEmailForAuth(normalizedEmail);
    const usable = !!user && user.status === 'active';

    // Uniform timing: known-bad-password and unknown/locked/inactive user do the SAME Argon2id work (sec §2).
    const passwordOk = usable
      ? await verifyPassword(user!.passwordHash, password, this.pepper)
      : await verifyPassword(await getDummyHash(this.pepper), password, this.pepper);

    if (!usable || !passwordOk) {
      const newCount = await this.rateLimiter.increment(failureKey, LOGIN_FAILURE_WINDOW_SECONDS);
      const newHardening = decideLoginHardening(newCount);
      if (newHardening.captchaRequired) this.alerts.failedLoginBurst(normalizedEmail, newCount);
      if (user && newHardening.locked) {
        this.setUserScope(user._id, user.tenantId, user.role);
        await this.users.updateOne({ _id: user._id }, { $set: { status: 'locked' } });
        this.alerts.lockoutTriggered(normalizedEmail);
      }
      throw new UnauthorizedException({ error: 'INVALID_CREDENTIALS' }); // identical body regardless of cause (sec §2)
    }

    await this.rateLimiter.reset(failureKey);

    const tenant = await this.tenants.findById(user!.tenantId);
    const edition = tenant?.edition ?? 'kb';
    this.setUserScope(user!._id, user!.tenantId, user!.role, edition);
    await this.users.updateOne({ _id: user!._id }, { $set: { lastLoginAt: new Date() } });

    const sessionId = await this.sessions.create('tenant', {
      userId: user!._id.toString(),
      tenantId: user!.tenantId.toString(),
      role: user!.role,
      edition,
      mfaVerified: false,
      tosVersion: user!.tosAcceptedVersion,
    });
    setSessionCookie(res, 'tenant', sessionId);

    return { mfaRequired: true };
  }

  @MfaExempt()
  @Post('totp')
  @HttpCode(200)
  async verifyTotpCode(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { code } = TotpVerifyRequestSchema.parse(body);
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope) throw new UnauthorizedException();

    const rateLimitKey = `totp-fail:${scope.userId.toString()}`;
    const attempts = await this.rateLimiter.increment(rateLimitKey, TOTP_RATE_WINDOW_SECONDS);
    if (attempts > TOTP_MAX_ATTEMPTS) throw new UnauthorizedException({ error: 'TOTP_RATE_LIMITED' });

    const user = await this.users.findById(scope.userId);
    if (!user) throw new UnauthorizedException();

    let verified = false;
    if (user.totpSecretEnvelope) {
      const secret = await decryptField(user.totpSecretEnvelope, this.kms);
      verified = verifyTotp(secret, code);
    }
    if (!verified && user.totpBackupCodeHashes.length > 0) {
      const idx = await verifyAndFindBackupCode(user.totpBackupCodeHashes, code, this.pepper);
      if (idx >= 0) {
        verified = true;
        const remaining = [...user.totpBackupCodeHashes];
        remaining.splice(idx, 1);
        await this.users.updateOne({ _id: user._id }, { $set: { totpBackupCodeHashes: remaining } });
      }
    }
    if (!verified) throw new UnauthorizedException({ error: 'INVALID_TOTP' });

    await this.rateLimiter.reset(rateLimitKey);

    const sessionId = req.cookies?.[REALM_COOKIE_NAME.tenant];
    const record = await this.sessions.get('tenant', sessionId);
    if (!record) throw new UnauthorizedException();

    const newSessionId = await this.sessions.rotate('tenant', sessionId, { ...record, mfaVerified: true });
    setSessionCookie(res, 'tenant', newSessionId);

    return { ok: true };
  }

  @TosExempt()
  @Post('tos/accept')
  @HttpCode(200)
  async acceptTos(@Body() body: unknown, @Req() req: Request) {
    const { version } = TosAcceptRequestSchema.parse(body);
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope) throw new UnauthorizedException();

    await this.users.updateOne({ _id: scope.userId }, { $set: { tosAcceptedVersion: version, tosAcceptedAt: new Date() } });

    const sessionId = req.cookies?.[REALM_COOKIE_NAME.tenant];
    const record = await this.sessions.get('tenant', sessionId);
    if (record) await this.sessions.touch('tenant', sessionId, { ...record, tosVersion: version });

    return { ok: true };
  }

  @Public()
  @Post('password-reset/request')
  @HttpCode(200)
  async requestPasswordReset(@Body() body: unknown) {
    const { email } = PasswordResetRequestSchema.parse(body);
    const user = await this.users.findByEmailForAuth(email);

    if (user && user.status !== 'inactive') {
      const { tokenHash, expiresAt } = createResetToken();
      this.setUserScope(user._id, user.tenantId, user.role);
      await this.users.updateOne({ _id: user._id }, { $set: { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt } });
      // Real delivery pending a transactional email provider decision (PRD §6) — the raw token
      // goes only in that email's link, never logged or returned here.
    }

    return { ok: true }; // identical response whether or not the email exists (enumeration resistance, sec §2)
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(200)
  async confirmPasswordReset(@Body() body: unknown) {
    const { email, token, newPassword } = PasswordResetConfirmSchema.parse(body);
    const user = await this.users.findByEmailForAuth(email);

    if (!user || !isResetTokenValid(token, user.passwordResetTokenHash, user.passwordResetExpiresAt)) {
      throw new UnauthorizedException({ error: 'INVALID_OR_EXPIRED_TOKEN' });
    }
    if (await isPasswordBreached(newPassword)) {
      throw new BadRequestException({ error: 'PASSWORD_BREACHED' });
    }

    const passwordHash = await hashPassword(newPassword, this.pepper);
    this.setUserScope(user._id, user.tenantId, user.role);
    await this.users.updateOne(
      { _id: user._id },
      { $set: { passwordHash }, $unset: { passwordResetTokenHash: '', passwordResetExpiresAt: '' } },
    );
    await this.sessions.revokeAll('tenant', user._id.toString()); // all sessions invalidated on reset (sec §2)

    return { ok: true };
  }

  @MfaExempt()
  @TosExempt()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sessionId = req.cookies?.[REALM_COOKIE_NAME.tenant];
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (sessionId && scope) await this.sessions.revoke('tenant', sessionId, scope.userId.toString());
    clearSessionCookie(res, 'tenant');
    return { ok: true };
  }

  private setUserScope(userId: { toString(): string }, tenantId: { toString(): string }, role: Scope['role'], edition: Scope['edition'] = 'kb') {
    this.cls.set(
      SCOPE_CLS_KEY,
      scopeFromIds({ userId: userId.toString(), tenantId: tenantId.toString(), role, edition }),
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
