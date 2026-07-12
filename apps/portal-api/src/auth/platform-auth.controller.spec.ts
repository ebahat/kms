import { UnauthorizedException } from '@nestjs/common';
import RedisMock from 'ioredis-mock';
import { hashPassword, RateLimiter, LocalMasterKeyProvider, encryptField, generateTotpSecret, NoopCaptchaVerifier } from '@kms/auth';
import { PLATFORM_SCOPE_CLS_KEY } from '@kms/data';
import { authenticator } from 'otplib';
import { PlatformAuthController } from './platform-auth.controller';

const PEPPER = 'test-pepper';
const MASTER_KEY_HEX = '22'.repeat(32);

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

describe('PlatformAuthController (ADR-0004 platform-admin login handshake)', () => {
  let admins: any;
  let sessions: any;
  let cls: FakeCls;
  let rateLimiter: RateLimiter;
  let alerts: any;
  let controller: PlatformAuthController;
  let realHash: string;

  beforeAll(async () => {
    realHash = await hashPassword('correct-horse-battery-staple', PEPPER);
  });

  beforeEach(() => {
    rateLimiter = new RateLimiter(new RedisMock() as any);
    admins = { findByEmail: jest.fn(), findById: jest.fn(), updateOne: jest.fn().mockResolvedValue(undefined) };
    sessions = {
      create: jest.fn().mockResolvedValue('sid'),
      get: jest.fn(),
      rotate: jest.fn().mockResolvedValue('rotated-sid'),
      revoke: jest.fn().mockResolvedValue(undefined),
      touch: jest.fn().mockResolvedValue(undefined),
    };
    cls = new FakeCls();
    alerts = { failedLoginBurst: jest.fn(), lockoutTriggered: jest.fn() };

    controller = new PlatformAuthController(
      admins,
      sessions,
      cls as any,
      PEPPER,
      new LocalMasterKeyProvider(MASTER_KEY_HEX),
      rateLimiter,
      new NoopCaptchaVerifier(),
      alerts,
    );
  });

  it('returns the same error for an unknown email as a known email + wrong password', async () => {
    admins.findByEmail.mockResolvedValueOnce(null);
    let unknownError: any;
    try {
      await controller.login({ email: 'nobody@x.com', password: 'whatever12345' }, fakeRes());
    } catch (e) {
      unknownError = e;
    }

    admins.findByEmail.mockResolvedValueOnce({ _id: fakeObjectIdHex(), status: 'active', passwordHash: realHash });
    let wrongPasswordError: any;
    try {
      await controller.login({ email: 'known@x.com', password: 'wrong' }, fakeRes());
    } catch (e) {
      wrongPasswordError = e;
    }

    expect(unknownError).toBeInstanceOf(UnauthorizedException);
    expect(wrongPasswordError).toBeInstanceOf(UnauthorizedException);
    expect(unknownError.getResponse()).toEqual(wrongPasswordError.getResponse());
  });

  it('logs in with the correct password and creates an interim (mfaVerified:false) session', async () => {
    const adminId = fakeObjectIdHex();
    admins.findByEmail.mockResolvedValue({ _id: adminId, status: 'active', passwordHash: realHash });
    const res = fakeRes();

    const result = await controller.login({ email: 'known@x.com', password: 'correct-horse-battery-staple' }, res);

    expect(result).toEqual({ mfaRequired: true });
    expect(sessions.create).toHaveBeenCalledWith('platform', expect.objectContaining({ mfaVerified: false, userId: adminId.toString() }));
    expect(res.cookie).toHaveBeenCalled();
  });

  it('accepts a valid TOTP code and rotates the session with mfaVerified:true', async () => {
    const secret = generateTotpSecret();
    const envelope = await encryptField(secret, new LocalMasterKeyProvider(MASTER_KEY_HEX));
    const adminId = fakeObjectIdHex();
    cls.set(PLATFORM_SCOPE_CLS_KEY, { adminId });
    admins.findById.mockResolvedValue({ _id: adminId, totpSecretEnvelope: envelope });
    sessions.get.mockResolvedValue({ userId: adminId, role: 'admin', mfaVerified: false, createdAt: '', lastSeenAt: '' });

    const res = fakeRes();
    const code = authenticator.generate(secret);
    const result = await controller.verifyTotpCode({ code }, { cookies: { '__Host-kms_padm': 'sid' } } as any, res);

    expect(result).toEqual({ ok: true });
    expect(sessions.rotate).toHaveBeenCalledWith('platform', 'sid', expect.objectContaining({ mfaVerified: true }));
  });

  it('rejects an incorrect TOTP code (no backup-code fallback in this realm)', async () => {
    const secret = generateTotpSecret();
    const envelope = await encryptField(secret, new LocalMasterKeyProvider(MASTER_KEY_HEX));
    const adminId = fakeObjectIdHex();
    cls.set(PLATFORM_SCOPE_CLS_KEY, { adminId });
    admins.findById.mockResolvedValue({ _id: adminId, totpSecretEnvelope: envelope });

    await expect(controller.verifyTotpCode({ code: '000000' }, { cookies: {} } as any, fakeRes())).rejects.toThrow(UnauthorizedException);
  });

  it('enrollTotp generates a secret + provisioning URI with no backup codes in this realm', async () => {
    const adminId = fakeObjectIdHex();
    cls.set(PLATFORM_SCOPE_CLS_KEY, { adminId });
    admins.findById.mockResolvedValue({ _id: adminId, email: 'admin@x.com' });

    const result = await controller.enrollTotp();

    expect(result.provisioningUri).toMatch(/^otpauth:\/\/totp\//);
    expect(result.secret).toEqual(expect.any(String));
    expect((result as any).backupCodes).toBeUndefined();
    expect(admins.updateOne).toHaveBeenCalledWith(adminId, expect.objectContaining({ $set: expect.objectContaining({ mfaEnabled: true }) }));
  });

  it('logout revokes the session and clears the cookie', async () => {
    const adminId = fakeObjectIdHex();
    cls.set(PLATFORM_SCOPE_CLS_KEY, { adminId });
    const res = fakeRes();

    const result = await controller.logout({ cookies: { '__Host-kms_padm': 'sid' } } as any, res);

    expect(result).toEqual({ ok: true });
    expect(sessions.revoke).toHaveBeenCalledWith('platform', 'sid', adminId.toString());
    expect(res.clearCookie).toHaveBeenCalled();
  });
});
