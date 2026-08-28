import { FolderDocument, GroupDocument } from '@kms/data';
import { FolderInput, GroupMemberRole, PrincipalSet } from './types';

/** FolderDocument (mongoose, ObjectId ids) -> FolderInput (plain strings) — the only place this package touches @kms/data shapes. */
export function toFolderInput(doc: FolderDocument): FolderInput {
  return {
    id: doc._id.toString(),
    parentId: doc.parentId ? doc.parentId.toString() : null,
    grants: doc.grants.map((grant) => ({
      principalType: grant.principalType,
      principalId: grant.principalId.toString(),
      access: grant.access,
    })),
    hasExplicitGrants: doc.hasExplicitGrants,
    isPublic: doc.isPublic,
  };
}

export function toFolderInputs(docs: FolderDocument[]): FolderInput[] {
  return docs.map(toFolderInput);
}

/**
 * The querying user + their role in every group they belong to (GroupsRepository.findForMember),
 * as the resolver's principal set. `memberGroups` is already filtered to this user's memberships,
 * but each group's `members` array still lists everyone — pull out just this user's own role
 * (2026-08-24 per-group-role plan). A group is dropped if the membership row is somehow absent
 * (defensive only — findForMember's query guarantees a match) rather than crashing the resolver.
 */
export function toPrincipalSet(userId: string, memberGroups: GroupDocument[]): PrincipalSet {
  const groups: { groupId: string; role: GroupMemberRole }[] = [];
  for (const group of memberGroups) {
    const membership = group.members.find((m) => m.userId.toString() === userId);
    if (membership) groups.push({ groupId: group._id.toString(), role: membership.role });
  }
  return { userId, groups };
}
