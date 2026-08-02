import { FolderDocument, GroupDocument } from '@kms/data';
import { FolderInput, PrincipalSet } from './types';

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

/** The querying user + every group they belong to (GroupsRepository.findForMember), as the resolver's principal set. */
export function toPrincipalSet(userId: string, memberGroups: GroupDocument[]): PrincipalSet {
  return { userId, groupIds: memberGroups.map((group) => group._id.toString()) };
}
