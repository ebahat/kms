import { BadRequestException, Controller, ForbiddenException, NotFoundException, Param, Post } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { toObjectId, PLATFORM_SCOPE_CLS_KEY, PlatformScope, PlatformAdminsRepository } from '@kms/data';

/**
 * Two-person MFA reset (ADR-0004): a locked-out admin has no self-service
 * backup-code path. A DIFFERENT platform admin must both request and then a
 * THIRD-party admin approve the reset — the requester can never also be the
 * approver, enforced here, not just by convention.
 */
@Controller('platform-admin/mfa-reset')
export class MfaResetController {
  constructor(
    private readonly admins: PlatformAdminsRepository,
    private readonly cls: ClsService,
  ) {}

  @Post(':targetId/request')
  async request(@Param('targetId') targetId: string): Promise<{ ok: true }> {
    const scope = this.cls.get<PlatformScope>(PLATFORM_SCOPE_CLS_KEY);
    const objectId = toObjectId(targetId);
    const target = await this.admins.findById(objectId);
    if (!target) throw new NotFoundException();

    await this.admins.updateOne(objectId, {
      $set: { pendingMfaResetRequestedBy: scope!.adminId, pendingMfaResetRequestedAt: new Date() },
    });
    return { ok: true };
  }

  @Post(':targetId/approve')
  async approve(@Param('targetId') targetId: string): Promise<{ ok: true }> {
    const scope = this.cls.get<PlatformScope>(PLATFORM_SCOPE_CLS_KEY);
    const objectId = toObjectId(targetId);
    const target = await this.admins.findById(objectId);
    if (!target) throw new NotFoundException();
    if (!target.pendingMfaResetRequestedBy) throw new BadRequestException({ error: 'NO_PENDING_RESET' });
    if (target.pendingMfaResetRequestedBy.toString() === scope!.adminId.toString()) {
      throw new ForbiddenException({ error: 'REQUESTER_CANNOT_APPROVE_OWN_RESET' }); // two-person control, not just single-admin self-service
    }

    await this.admins.updateOne(objectId, {
      $set: { mfaEnabled: false },
      $unset: { totpSecretEnvelope: '', pendingMfaResetRequestedBy: '', pendingMfaResetRequestedAt: '' },
    });
    return { ok: true }; // target must re-enroll TOTP on next login
  }
}
