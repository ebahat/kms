import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import {
  LoginRequestSchema,
  TotpVerifyRequestSchema,
  PasswordResetRequestSchema,
  PasswordResetConfirmSchema,
  ActivateCheckRequestSchema,
  ActivateConfirmRequestSchema,
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
  encryptField,
  decryptField,
  KmsKeyProvider,
  generateTotpSecret,
  totpProvisioningUri,
  generateBackupCodes,
  hashBackupCodes,
  verifyAndFindBackupCode,
  createResetToken,
  isResetTokenValid,
  isInviteTokenValid,
  isPasswordBreached,
  decideLoginHardening,
  RateLimiter,
  CaptchaVerifier,
  SecurityAlertSink,
} from '@kms/auth';
import { scopeFromIds, SCOPE_CLS_KEY, Scope, TenantsRepository, UsersRepository } from '@kms/data';
import { inferTenantLogoContentType, StorageProvider } from '@kms/storage';
import { SESSION_SERVICE } from './session-auth.guard';
import { setSessionCookie, clearSessionCookie } from './cookie';
import { PASSWORD_PEPPER, KMS_KEY_PROVIDER, RATE_LIMITER, CAPTCHA_VERIFIER, SECURITY_ALERT_SINK } from './auth.providers';
import { NOTIFICATION_PROVIDER, NotificationProvider } from '../notifications/notifications.providers';
import { STORAGE_PROVIDER } from '../documents/documents.providers';

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
    @Inject(NOTIFICATION_PROVIDER) private readonly notifications: NotificationProvider,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
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
    const featureToggles = tenant?.featureToggles ?? [];
    this.setUserScope(user!._id, user!.tenantId, user!.role, edition, featureToggles);
    await this.users.updateOne({ _id: user!._id }, { $set: { lastLoginAt: new Date() } });

    const sessionId = await this.sessions.create('tenant', {
      userId: user!._id.toString(),
      tenantId: user!.tenantId.toString(),
      role: user!.role,
      edition,
      featureToggles,
      mfaVerified: false,
      tosVersion: user!.tosAcceptedVersion,
    });
    setSessionCookie(res, 'tenant', sessionId);

    return { mfaRequired: true, mfaEnrolled: user!.mfaEnabled };
  }

  /** First-login TOTP setup (UI spec A3): QR + manual secret + one-time backup codes. Re-enrollable while still unverified. */
  @MfaExempt()
  @Post('totp/enroll')
  @HttpCode(200)
  async enrollTotp() {
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope) throw new UnauthorizedException();

    const user = await this.users.findById(scope.userId);
    if (!user) throw new UnauthorizedException();

    const secret = generateTotpSecret();
    const envelope = await encryptField(secret, this.kms);
    const backupCodes = generateBackupCodes();
    const backupCodeHashes = await hashBackupCodes(backupCodes, this.pepper);

    await this.users.updateOne(
      { _id: user._id },
      { $set: { totpSecretEnvelope: envelope, totpBackupCodeHashes: backupCodeHashes, mfaEnabled: true } },
    );

    return {
      provisioningUri: totpProvisioningUri(secret, user.email),
      secret,
      backupCodes, // shown ONCE — never retrievable again after this response
    };
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

    // status === 'active' only (not merely "!== 'inactive'") — a 'pending' user has never
    // activated their invite yet; handing them a *reset* link here would let them set a password
    // without ever consuming the invite token, bypassing activation entirely (user-management
    // plan, 2026-08-24). They get a working link via resend-invite instead.
    if (user && user.status === 'active') {
      const { rawToken, tokenHash, expiresAt } = createResetToken();
      this.setUserScope(user._id, user.tenantId, user.role);
      await this.users.updateOne({ _id: user._id }, { $set: { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt } });
      // ADR-0013's provider now exists (previously blocked on this) — the raw token goes only in
      // this email's link, never logged or returned from this endpoint itself (sec §2).
      const appUrl = process.env.APP_PUBLIC_URL ?? 'http://localhost:3010';
      const resetLink = `${appUrl}/password-reset/confirm?email=${encodeURIComponent(email)}&token=${rawToken}`;
      await this.notifications.sendEmail({
        to: email,
        subject: 'איפוס סיסמה',
        body: `לאיפוס הסיסמה שלך, לחץ/י על הקישור הבא (בתוקף לזמן מוגבל): ${resetLink}`,
      });
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

  /**
   * Lets the /activate screen tell "this link is expired/wrong" apart from "not yet submitted" —
   * checked before the user types a password, not after (user-management plan, 2026-08-24). No
   * user data in the response, just a boolean: the token itself already implies enumeration is
   * bounded to whoever received the invite email.
   */
  @Public()
  @Post('activate/check')
  @HttpCode(200)
  async checkActivationToken(@Body() body: unknown) {
    const { email, token } = ActivateCheckRequestSchema.parse(body);
    const user = await this.users.findByEmailForAuth(email);
    return { valid: !!user && user.status === 'pending' && isInviteTokenValid(token, user.inviteTokenHash, user.inviteExpiresAt) };
  }

  @Public()
  @Post('activate/confirm')
  @HttpCode(200)
  async confirmActivation(@Body() body: unknown) {
    const { email, token, newPassword } = ActivateConfirmRequestSchema.parse(body);
    const user = await this.users.findByEmailForAuth(email);

    if (!user || user.status !== 'pending' || !isInviteTokenValid(token, user.inviteTokenHash, user.inviteExpiresAt)) {
      throw new UnauthorizedException({ error: 'INVALID_OR_EXPIRED_TOKEN' });
    }
    if (await isPasswordBreached(newPassword)) {
      throw new BadRequestException({ error: 'PASSWORD_BREACHED' });
    }

    const passwordHash = await hashPassword(newPassword, this.pepper);
    this.setUserScope(user._id, user.tenantId, user.role);
    await this.users.updateOne(
      { _id: user._id },
      { $set: { passwordHash, status: 'active', activatedAt: new Date() }, $unset: { inviteTokenHash: '', inviteExpiresAt: '' } },
    );

    return { ok: true };
  }

  /** Minimal "whoami" — drives edition/role-based navigation client-side (UI spec). Gated normally: fully authenticated only. */
  @Get('session')
  async getSession() {
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope) throw new UnauthorizedException();
    // tenantName drives the app-shell header (Phase B, 2026-08-22) — real data, not a placeholder.
    const tenant = await this.tenants.findById(scope.tenantId);

    // logoUrl (Phase C, C1.3): issued fresh per session load, never stored — preserves the
    // "files served only via short-lived signed URLs" security invariant even for branding assets
    // that aren't confidential. One extra signed-URL issuance per session load, not per page.
    // Signing failure degrades to "no logo," not a broken session: this endpoint is the whoami
    // every authenticated page load depends on, so a missing/unreachable object must never take
    // down login for an entire tenant over what's ultimately cosmetic branding (found via live
    // verification: a storage-layer hiccup here previously 500'd every session check).
    let logoUrl: string | undefined;
    if (tenant?.logoObjectKey) {
      try {
        const signed = await this.storage.getSignedDownloadUrl(tenant.logoObjectKey, {
          displayFilename: 'logo',
          inline: true,
          contentType: inferTenantLogoContentType(tenant.logoObjectKey),
        });
        logoUrl = signed.url;
      } catch {
        logoUrl = undefined;
      }
    }

    return {
      role: scope.role,
      edition: scope.edition,
      tenantName: tenant?.name ?? '',
      logoUrl,
      themeColorRgb: tenant?.themeColorRgb,
    };
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

  private setUserScope(
    userId: { toString(): string },
    tenantId: { toString(): string },
    role: Scope['role'],
    edition: Scope['edition'] = 'kb',
    featureToggles: string[] = [],
  ) {
    this.cls.set(
      SCOPE_CLS_KEY,
      scopeFromIds({ userId: userId.toString(), tenantId: tenantId.toString(), role, edition, featureToggles }),
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
