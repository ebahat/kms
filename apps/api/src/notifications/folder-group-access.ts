import { FoldersRepository, newObjectId } from '@kms/data';

/** Local alias so this file never imports `mongoose` itself (ADR-0001 confines that to libs/data). */
type ObjectId = ReturnType<typeof newObjectId>;

/**
 * Folders a group can reach via a *direct* group grant only — no inheritance,
 * no public folders, no direct-user grants. This intentionally does not
 * reuse libs/permissions' full resolver: it's a recipient-discovery scan for
 * the "all" notification preference, not an authorization decision, so a
 * false negative here only means a missed email, never a security issue.
 */
export async function foldersAccessibleToGroup(folders: FoldersRepository, groupId: ObjectId): Promise<ObjectId[]> {
  const all = await folders.findAllForTenant();
  return all.filter((f) => f.grants.some((g) => g.principalType === 'group' && g.principalId.equals(groupId))).map((f) => f._id);
}
