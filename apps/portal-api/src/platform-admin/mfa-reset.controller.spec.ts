import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MfaResetController } from './mfa-reset.controller';
import { PLATFORM_SCOPE_CLS_KEY } from '@kms/data';

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

describe('MfaResetController (ADR-0004 two-person control)', () => {
  let admins: any;
  let cls: FakeCls;
  let controller: MfaResetController;

  beforeEach(() => {
    admins = { findById: jest.fn(), updateOne: jest.fn().mockResolvedValue(undefined) };
    cls = new FakeCls();
    controller = new MfaResetController(admins, cls as any);
  });

  it('404s a request for a target admin that does not exist', async () => {
    admins.findById.mockResolvedValue(null);
    cls.set(PLATFORM_SCOPE_CLS_KEY, { adminId: fakeObjectIdHex() });
    await expect(controller.request(fakeObjectIdHex())).rejects.toThrow(NotFoundException);
  });

  it('records the requester on a pending reset', async () => {
    const targetId = fakeObjectIdHex();
    const requesterId = fakeObjectIdHex();
    admins.findById.mockResolvedValue({ _id: targetId });
    cls.set(PLATFORM_SCOPE_CLS_KEY, { adminId: requesterId });

    const result = await controller.request(targetId);

    expect(result).toEqual({ ok: true });
    expect(admins.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: expect.objectContaining({ pendingMfaResetRequestedBy: requesterId }) }),
    );
  });

  it('rejects approval when there is no pending request', async () => {
    admins.findById.mockResolvedValue({ _id: fakeObjectIdHex(), pendingMfaResetRequestedBy: undefined });
    cls.set(PLATFORM_SCOPE_CLS_KEY, { adminId: fakeObjectIdHex() });
    await expect(controller.approve(fakeObjectIdHex())).rejects.toThrow(BadRequestException);
  });

  it('rejects the SAME admin approving their own request — the core two-person invariant', async () => {
    const requesterId = fakeObjectIdHex();
    admins.findById.mockResolvedValue({ _id: fakeObjectIdHex(), pendingMfaResetRequestedBy: requesterId });
    cls.set(PLATFORM_SCOPE_CLS_KEY, { adminId: requesterId }); // approver === requester

    await expect(controller.approve(fakeObjectIdHex())).rejects.toThrow(ForbiddenException);
  });

  it('allows a DIFFERENT admin to approve, clearing the TOTP secret and pending fields', async () => {
    const requesterId = fakeObjectIdHex();
    const approverId = fakeObjectIdHex();
    const targetId = fakeObjectIdHex();
    admins.findById.mockResolvedValue({ _id: targetId, pendingMfaResetRequestedBy: requesterId });
    cls.set(PLATFORM_SCOPE_CLS_KEY, { adminId: approverId });

    const result = await controller.approve(targetId);

    expect(result).toEqual({ ok: true });
    expect(admins.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: { mfaEnabled: false },
        $unset: { totpSecretEnvelope: '', pendingMfaResetRequestedBy: '', pendingMfaResetRequestedAt: '' },
      }),
    );
  });
});
