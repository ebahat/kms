import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { GroupsRepository, MissingScopeError, SCOPE_CLS_KEY, Scope, toObjectId } from '@kms/data';

@Injectable()
export class GroupsMembershipService {
  constructor(
    private readonly cls: ClsService,
    private readonly groups: GroupsRepository,
  ) {}

  /** Any group member may read/create/edit/delete events and tasks in that group (Phase 2A design, decision 2). Tenant admins bypass, matching the existing PRD §7 precedent in DocumentsPermissionsService. */
  async isMember(groupId: string): Promise<boolean> {
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope) throw new MissingScopeError('GroupsMembershipService');

    const group = await this.groups.findById(toObjectId(groupId));
    if (!group) return false;
    if (scope.role === 'admin') return true;

    return group.memberUserIds.some((id) => id.equals(scope.userId));
  }
}
