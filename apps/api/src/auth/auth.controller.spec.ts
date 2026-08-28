import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import RedisMock from 'ioredis-mock';
import { hashPassword, RateLimiter, LocalMasterKeyProvider, encryptField, generateTotpSecret, NoopCaptchaVerifier } from '@kms/auth';
import { SCOPE_CLS_KEY } from '@kms/data';
import { authenticator } from 'otplib';
import { AuthController } from './auth.controller';

const PEPPER = 'test-pepper';
const MASTER_KEY_HEX = '11'.repeat(32);

function fakeObjectIdHex(): string {
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

class FakeCls {
  private store = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  set(key: string, value: unknown) {
    this.store.set(key, value);
  }
}

function fakeRes() {
  return { cookie: jest.fn(), clearCookie: jest.fn() } as any;
}

describe('AuthController (ADR-0004 login handshake)', () => {
  let users: any;
  let tenants: any;
  let sessions: any;
  let cls: FakeCls;
  let rateLimiter: RateLimiter;
  let alerts: any;
  let notifications: any;
  let storage: any;
  let controller: AuthController;
  let realHash: string;

  beforeAll(async () => {
    realHash = await hashPassword('correct-horse-battery-staple', PEPPER);
  });

  beforeEach(async () => {
    const redis = new RedisMock();
    await redis.flushall();
    rateLimiter = new RateLimiter(redis as any);

    users = {
      findByEmailForAuth: jest.fn(),
      findById: jest.fn(),
      updateOne: jest.fn().mockResolvedValue(undefined),
    };
    tenants = { findById: jest.fn().mockResolvedValue({ edition: 'kb' }) };
    sessions = {
      create: jest.fn().mockResolvedValue('new-session-id'),
      get: jest.fn(),
      rotate: jest.fn().mockResolvedValue('rotated-session-id'),
      revoke: jest.fn().mockResolvedValue(undefined),
      revokeAll: jest.fn().mockResolvedValue(undefined),
      touch: jest.fn().mockResolvedValue(undefined),
    };
    cls = new FakeCls();
    alerts = { failedLoginBurst: jest.fn(), lockoutTriggered: jest.fn() };
    notifications = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    storage = { getSignedDownloadUrl: jest.fn() };

    controller = new AuthController(
      users,
      tenants,
      sessions,
      cls as any,
      PEPPER,
      new LocalMasterKeyProvider(MASTER_KEY_HEX),
      rateLimiter,
      new NoopCaptchaVerifier(),
      alerts,
      notifications,
      storage,
    );
  });

  describe('login', () => {
    it('returns the same error for an unknown email as for a known email + wrong password', async () => {
      users.findByEmailForAuth.mockResolvedValueOnce(null);
      let unknownError: any;
      try {
        await controller.login({ email: 'nobody@x.com', password: 'whatever12345' }, fakeRes());
      } catch (e) {
        unknownError = e;
      }

      users.findByEmailForAuth.mockResolvedValueOnce({
        _id: fakeObjectIdHex(),
        tenantId: fakeObjectIdHex(),
        role: 'user',
        status: 'active',
        passwordHash: realHash,
      });
      let wrongPasswordError: any;
      try {
        await controller.login({ email: 'known@x.com', password: 'totally-wrong-pw' }, fakeRes());
      } catch (e) {
        wrongPasswordError = e;
      }

      expect(unknownError).toBeInstanceOf(UnauthorizedException);
      expect(wrongPasswordError).toBeInstanceOf(UnauthorizedException);
      expect(unknownError.getResponse()).toEqual(wrongPasswordError.getResponse());
    });

    it('logs in successfully with the correct password: creates an interim (mfaVerified:false) session and sets the cookie', async () => {
      const userId = fakeObjectIdHex();
      const tenantId = fakeObjectIdHex();
      users.findByEmailForAuth.mockResolvedValue({
        _id: userId,
        tenantId,
        role: 'user',
        status: 'active',
        passwordHash: realHash,
        tosAcceptedVersion: undefined,
      });
      const res = fakeRes();

      const result = await controller.login({ email: 'known@x.com', password: 'correct-horse-battery-staple' }, res);

      expect(result).toEqual({ mfaRequired: true });
      expect(sessions.create).toHaveBeenCalledWith('tenant', expect.objectContaining({ mfaVerified: false, userId: userId.toString() }));
      expect(res.cookie).toHaveBeenCalled();
    });

    it('locks the account on the 10th failure and alerts', async () => {
      const userId = fakeObjectIdHex();
      const tenantId = fakeObjectIdHex();
      users.findByEmailForAuth.mockResolvedValue({ _id: userId, tenantId, role: 'user', status: 'active', passwordHash: realHash });

      // Pre-seed 9 prior failures directly on the rate limiter so this test exercises the
      // lockout branch on the 10th call without paying for 9 real progressive-delay sleeps.
      for (let i = 0; i < 9; i++) await rateLimiter.increment('login-fail:lockout@x.com', 900);

      await expect(controller.login({ email: 'lockout@x.com', password: 'wrong' }, fakeRes())).rejects.toThrow(UnauthorizedException);

      expect(alerts.lockoutTriggered).toHaveBeenCalledWith('lockout@x.com');
      expect(users.updateOne).toHaveBeenCalledWith({ _id: userId }, { $set: { status: 'locked' } });
    }, 15000);
  });

  describe('verifyTotpCode', () => {
    it('accepts a valid TOTP code, rotates the session, and marks mfaVerified', async () => {
      const secret = generateTotpSecret();
      const envelope = await encryptField(secret, new LocalMasterKeyProvider(MASTER_KEY_HEX));
      const userId = fakeObjectIdHex();
      const tenantId = fakeObjectIdHex();
      cls.set(SCOPE_CLS_KEY, { userId, tenantId, role: 'user', edition: 'kb' });
      users.findById.mockResolvedValue({ _id: userId, totpSecretEnvelope: envelope, totpBackupCodeHashes: [] });
      sessions.get.mockResolvedValue({ userId, tenantId, role: 'user', edition: 'kb', mfaVerified: false, createdAt: '', lastSeenAt: '' });

      const res = fakeRes();
      const code = authenticator.generate(secret);
      const result = await controller.verifyTotpCode({ code }, { cookies: { '__Host-kms_sess': 'sid' } } as any, res);

      expect(result).toEqual({ ok: true });
      expect(sessions.rotate).toHaveBeenCalledWith('tenant', 'sid', expect.objectContaining({ mfaVerified: true }));
      expect(res.cookie).toHaveBeenCalled();
    });

    it('rejects an incorrect TOTP code', async () => {
      const secret = generateTotpSecret();
      const envelope = await encryptField(secret, new LocalMasterKeyProvider(MASTER_KEY_HEX));
      const userId = fakeObjectIdHex();
      cls.set(SCOPE_CLS_KEY, { userId, tenantId: fakeObjectIdHex(), role: 'user', edition: 'kb' });
      users.findById.mockResolvedValue({ _id: userId, totpSecretEnvelope: envelope, totpBackupCodeHashes: [] });

      await expect(
        controller.verifyTotpCode({ code: '000000' }, { cookies: {} } as any, fakeRes()),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('enrollTotp', () => {
    it('generates a fresh secret + provisioning URI + 10 backup codes, and stores them encrypted/hashed', async () => {
      const userId = fakeObjectIdHex();
      cls.set(SCOPE_CLS_KEY, { userId, tenantId: fakeObjectIdHex(), role: 'user', edition: 'kb' });
      users.findById.mockResolvedValue({ _id: userId, email: 'user@x.com' });

      const result = await controller.enrollTotp();

      expect(result.provisioningUri).toMatch(/^otpauth:\/\/totp\//);
      expect(result.secret).toEqual(expect.any(String));
      expect(result.backupCodes).toHaveLength(10);
      expect(users.updateOne).toHaveBeenCalledWith(
        { _id: userId },
        expect.objectContaining({ $set: expect.objectContaining({ mfaEnabled: true }) }),
      );
    });
  });

  describe('getSession', () => {
    it('includes the tenant name, used by the app-shell header (Phase B)', async () => {
      cls.set(SCOPE_CLS_KEY, { userId: fakeObjectIdHex(), tenantId: fakeObjectIdHex(), role: 'admin', edition: 'kb' });
      tenants.findById.mockResolvedValueOnce({ edition: 'kb', name: 'Acme Corp' });

      const result = await controller.getSession();

      expect(result).toEqual({ role: 'admin', edition: 'kb', tenantName: 'Acme Corp' });
      expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('omits logoUrl/themeColorRgb when the tenant has neither set (Phase C, C1.3/C1.4)', async () => {
      cls.set(SCOPE_CLS_KEY, { userId: fakeObjectIdHex(), tenantId: fakeObjectIdHex(), role: 'user', edition: 'kb' });
      tenants.findById.mockResolvedValueOnce({ edition: 'kb', name: 'Acme Corp' });

      const result = await controller.getSession();

      expect(result.logoUrl).toBeUndefined();
      expect(result.themeColorRgb).toBeUndefined();
    });

    it('issues a fresh signed URL for logoUrl when the tenant has a logoObjectKey (Phase C, C1.3)', async () => {
      cls.set(SCOPE_CLS_KEY, { userId: fakeObjectIdHex(), tenantId: fakeObjectIdHex(), role: 'user', edition: 'kb' });
      tenants.findById.mockResolvedValueOnce({ edition: 'kb', name: 'Acme Corp', logoObjectKey: 'tenants/t1/logo/abc.png', themeColorRgb: '#123456' });
      storage.getSignedDownloadUrl.mockResolvedValueOnce({ url: 'https://signed.example/logo.png', expiresAt: new Date() });

      const result = await controller.getSession();

      expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(
        'tenants/t1/logo/abc.png',
        expect.objectContaining({ displayFilename: expect.any(String), inline: true, contentType: 'image/png' }),
      );
      expect(result.logoUrl).toBe('https://signed.example/logo.png');
      expect(result.themeColorRgb).toBe('#123456');
    });

    it('degrades to no logoUrl (not a 500) when signing fails, since this endpoint must never break login for cosmetic branding', async () => {
      cls.set(SCOPE_CLS_KEY, { userId: fakeObjectIdHex(), tenantId: fakeObjectIdHex(), role: 'user', edition: 'kb' });
      tenants.findById.mockResolvedValueOnce({ edition: 'kb', name: 'Acme Corp', logoObjectKey: 'tenants/t1/logo/missing.png' });
      storage.getSignedDownloadUrl.mockRejectedValueOnce(new Error('no object at key'));

      const result = await controller.getSession();

      expect(result.logoUrl).toBeUndefined();
      expect(result.role).toBe('user');
    });
  });

  describe('logout', () => {
    it('revokes the session and clears the cookie', async () => {
      const userId = fakeObjectIdHex();
      cls.set(SCOPE_CLS_KEY, { userId, tenantId: fakeObjectIdHex(), role: 'user', edition: 'kb' });
      const res = fakeRes();

      const result = await controller.logout({ cookies: { '__Host-kms_sess': 'sid' } } as any, res);

      expect(result).toEqual({ ok: true });
      expect(sessions.revoke).toHaveBeenCalledWith('tenant', 'sid', userId.toString());
      expect(res.clearCookie).toHaveBeenCalled();
    });
  });

  describe('password reset request', () => {
    it('emails a reset link to a known, active user', async () => {
      users.findByEmailForAuth.mockResolvedValueOnce({
        _id: fakeObjectIdHex(),
        tenantId: fakeObjectIdHex(),
        role: 'user',
        status: 'active',
      });

      const result = await controller.requestPasswordReset({ email: 'a@b.com' });

      expect(result).toEqual({ ok: true });
      expect(notifications.sendEmail).toHaveBeenCalledTimes(1);
      const call = notifications.sendEmail.mock.calls[0][0];
      expect(call.to).toBe('a@b.com');
      expect(call.body).toContain('token=');
    });

    it('sends no email for an unknown user, but returns the same response (enumeration resistance)', async () => {
      users.findByEmailForAuth.mockResolvedValueOnce(null);

      const result = await controller.requestPasswordReset({ email: 'nobody@x.com' });

      expect(result).toEqual({ ok: true });
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });

    it('sends no email for an inactive user', async () => {
      users.findByEmailForAuth.mockResolvedValueOnce({
        _id: fakeObjectIdHex(),
        tenantId: fakeObjectIdHex(),
        role: 'user',
        status: 'inactive',
      });

      await controller.requestPasswordReset({ email: 'a@b.com' });

      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });

    it('sends no email for a pending user — they must consume their invite, not a reset link (user-management plan, 2026-08-24)', async () => {
      users.findByEmailForAuth.mockResolvedValueOnce({
        _id: fakeObjectIdHex(),
        tenantId: fakeObjectIdHex(),
        role: 'user',
        status: 'pending',
      });

      const result = await controller.requestPasswordReset({ email: 'invited@b.com' });

      expect(result).toEqual({ ok: true }); // same response either way (enumeration resistance)
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('login (pending users)', () => {
    it('rejects a pending user with the same generic error as bad credentials', async () => {
      users.findByEmailForAuth.mockResolvedValueOnce({
        _id: fakeObjectIdHex(),
        tenantId: fakeObjectIdHex(),
        role: 'user',
        status: 'pending',
        passwordHash: realHash,
      });

      await expect(
        controller.login({ email: 'invited@b.com', password: 'correct-horse-battery-staple' }, fakeRes()),
      ).rejects.toThrow(UnauthorizedException);
      expect(sessions.create).not.toHaveBeenCalled();
    });
  });

  describe('activation (user-management plan, 2026-08-24)', () => {
    describe('activate/check', () => {
      it('is valid for a pending user with a matching, unexpired token', async () => {
        users.findByEmailForAuth.mockResolvedValueOnce({
          status: 'pending',
          inviteTokenHash: createHash('sha256').update('good-token', 'utf8').digest('hex'),
          inviteExpiresAt: new Date(Date.now() + 60_000),
        });

        const result = await controller.checkActivationToken({ email: 'a@b.com', token: 'good-token' });
        expect(result).toEqual({ valid: true });
      });

      it('is invalid for an unknown user (no enumeration signal beyond the boolean)', async () => {
        users.findByEmailForAuth.mockResolvedValueOnce(null);
        const result = await controller.checkActivationToken({ email: 'nobody@b.com', token: 'anything' });
        expect(result).toEqual({ valid: false });
      });

      it('is invalid for a user who already activated (status active, not pending)', async () => {
        users.findByEmailForAuth.mockResolvedValueOnce({
          status: 'active',
          inviteTokenHash: undefined,
          inviteExpiresAt: undefined,
        });
        const result = await controller.checkActivationToken({ email: 'a@b.com', token: 'stale-token' });
        expect(result).toEqual({ valid: false });
      });

      it('is invalid for an expired token', async () => {
        users.findByEmailForAuth.mockResolvedValueOnce({
          status: 'pending',
          inviteTokenHash: createHash('sha256').update('good-token', 'utf8').digest('hex'),
          inviteExpiresAt: new Date(Date.now() - 1000),
        });
        const result = await controller.checkActivationToken({ email: 'a@b.com', token: 'good-token' });
        expect(result).toEqual({ valid: false });
      });
    });

    describe('activate/confirm', () => {
      it('sets a real password, flips status to active, stamps activatedAt, and clears the invite token', async () => {
        const userId = fakeObjectIdHex();
        const tokenHash = createHash('sha256').update('good-token', 'utf8').digest('hex');
        users.findByEmailForAuth.mockResolvedValueOnce({
          _id: userId,
          tenantId: fakeObjectIdHex(),
          role: 'user',
          status: 'pending',
          inviteTokenHash: tokenHash,
          inviteExpiresAt: new Date(Date.now() + 60_000),
        });

        const result = await controller.confirmActivation({ email: 'a@b.com', token: 'good-token', newPassword: 'a-long-enough-password-123' });

        expect(result).toEqual({ ok: true });
        expect(users.updateOne).toHaveBeenCalledWith(
          { _id: userId },
          {
            $set: { passwordHash: expect.any(String), status: 'active', activatedAt: expect.any(Date) },
            $unset: { inviteTokenHash: '', inviteExpiresAt: '' },
          },
        );
      });

      it('rejects an expired or wrong token', async () => {
        users.findByEmailForAuth.mockResolvedValueOnce({
          status: 'pending',
          inviteTokenHash: undefined,
          inviteExpiresAt: undefined,
        });

        await expect(
          controller.confirmActivation({ email: 'a@b.com', token: 'wrong', newPassword: 'a-long-enough-password-123' }),
        ).rejects.toThrow(UnauthorizedException);
      });

      it('rejects an already-active user reusing an old invite link', async () => {
        const tokenHash = createHash('sha256').update('good-token', 'utf8').digest('hex');
        users.findByEmailForAuth.mockResolvedValueOnce({
          status: 'active',
          inviteTokenHash: tokenHash,
          inviteExpiresAt: new Date(Date.now() + 60_000),
        });

        await expect(
          controller.confirmActivation({ email: 'a@b.com', token: 'good-token', newPassword: 'a-long-enough-password-123' }),
        ).rejects.toThrow(UnauthorizedException);
      });

      it('rejects a password shorter than the 12-character floor', async () => {
        await expect(
          controller.confirmActivation({ email: 'a@b.com', token: 'good-token', newPassword: 'short' }),
        ).rejects.toThrow();
      });
    });
  });

  describe('password reset confirm', () => {
    it('rejects an invalid/expired token', async () => {
      users.findByEmailForAuth.mockResolvedValue({
        _id: fakeObjectIdHex(),
        tenantId: fakeObjectIdHex(),
        role: 'user',
        passwordResetTokenHash: undefined,
        passwordResetExpiresAt: undefined,
      });

      await expect(
        controller.confirmPasswordReset({ email: 'a@b.com', token: 'x', newPassword: 'a-long-enough-password-123' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
