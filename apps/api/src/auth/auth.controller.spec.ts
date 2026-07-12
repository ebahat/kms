import { UnauthorizedException } from '@nestjs/common';
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
