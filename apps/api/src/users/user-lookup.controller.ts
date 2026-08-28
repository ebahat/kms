import { BadRequestException, Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { Edition } from '@kms/contracts';
import { UserLookupResult } from '@kms/contracts';
import { UserDocument, UsersRepository } from '@kms/data';

/**
 * In-tenant "find a colleague by email" lookup (2026-08-28 bug fix) — deliberately NOT under
 * `AdminOnlyGuard` like `TenantUsersAdminController`: adding a member to a group or granting a
 * folder to a user only ever required `manage`-tier access to that specific group/folder, never
 * tenant-admin — but until this endpoint existed, `principalId`/`userId` fields required a raw
 * 24-hex-char Mongo ObjectId with no way for a non-admin manager to discover one from the only
 * thing they actually know: the person's email. Returns a deliberately minimal shape
 * (`UserLookupResult`, not the admin-only `UserSummary`) — this is reachable by any authenticated
 * tenant member, same "workplace directory" visibility level every group's member list already has.
 */
@Controller('tenant-users')
@Edition('both')
export class UserLookupController {
  constructor(private readonly users: UsersRepository) {}

  @Get('lookup')
  async lookup(@Query('email') email: string | undefined): Promise<UserLookupResult> {
    if (!email?.trim()) throw new BadRequestException('email is required');

    const user = await this.users.findByEmailInTenant(email);
    if (!user) throw new NotFoundException();

    return toLookupResult(user);
  }
}

function toLookupResult(doc: UserDocument): UserLookupResult {
  const name = [doc.firstName, doc.lastName].filter(Boolean).join(' ').trim();
  return { id: doc._id.toString(), email: doc.email, name: name || doc.email };
}
