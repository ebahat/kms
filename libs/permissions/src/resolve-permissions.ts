import {
  DecidingGrant,
  FolderGrantInput,
  FolderInput,
  FolderPermissionResolution,
  FolderWideningInfo,
  PrincipalSet,
  tierRank,
} from './types';

interface EffectiveBundle {
  grants: FolderGrantInput[];
  isPublic: boolean;
}

/**
 * ADR-0005 step 2: a folder's effective grants+isPublic are its own if
 * `hasExplicitGrants`, else its parent's effective bundle — override, never
 * merge, and the whole {grants, isPublic} pair moves together as one unit.
 * Root folders with no explicit grants get their own (typically empty) bundle
 * since there is nothing above them to inherit from.
 *
 * Memoized recursion reaches the same result as an explicit depth-first sort
 * (ADR-0005 step 1) without needing one.
 */
/** Deny-all: no grants, not public. Used when a folder's parent chain is broken (see resolve() below). */
const ORPHAN_BUNDLE: EffectiveBundle = { grants: [], isPublic: false };

function computeEffectiveBundles(folders: FolderInput[]): Map<string, EffectiveBundle> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const effective = new Map<string, EffectiveBundle>();
  const inProgress = new Set<string>();

  function resolve(folderId: string): EffectiveBundle {
    const cached = effective.get(folderId);
    if (cached) return cached;

    const folder = byId.get(folderId);
    if (!folder) {
      // A parentId that doesn't resolve inside the input set (corrupt/dangling data — the repository
      // layer rejects this at write time as of Phase 2 plan Task 1, but this function must still fail
      // safe against any row that predates that fix, or a caller bug elsewhere). Fail closed for this
      // folder's subtree alone rather than throwing and aborting resolution for the entire tenant —
      // an orphan grants nothing, which is exactly the safe interpretation, and every other folder in
      // the tenant keeps resolving normally.
      return ORPHAN_BUNDLE;
    }
    if (inProgress.has(folderId)) {
      // A cycle, unlike an orphan, is unambiguously a bug (a folder cannot legitimately be its own
      // ancestor) — this stays a hard failure rather than a fail-closed degrade.
      throw new Error(`resolveFolderPermissions: cycle detected in folder parent chain at "${folderId}".`);
    }

    let bundle: EffectiveBundle;
    if (folder.hasExplicitGrants || !folder.parentId) {
      bundle = { grants: folder.grants, isPublic: folder.isPublic };
    } else {
      inProgress.add(folderId);
      bundle = resolve(folder.parentId);
      inProgress.delete(folderId);
    }

    effective.set(folderId, bundle);
    return bundle;
  }

  for (const folder of folders) resolve(folder.id);
  return effective;
}

function grantKey(principalType: 'user' | 'group', principalId: string): string {
  return `${principalType}:${principalId}`;
}

/** All principal keys (incl. `*` for public) with at least read access under a bundle — every grant tier implies read (manage > edit > read). */
function readPrincipalKeys(bundle: EffectiveBundle): Set<string> {
  const keys = new Set<string>();
  if (bundle.isPublic) keys.add('*');
  for (const grant of bundle.grants) keys.add(grantKey(grant.principalType, grant.principalId));
  return keys;
}

/**
 * ADR-0005's resolution algorithm (steps 2-4): the pure function that turns
 * every tenant folder + a user's principal set into their effective
 * permitted-folder sets. `folders` must be the tenant's complete folder list
 * (FoldersRepository.findAllForTenant()) — this function does not fetch data.
 */
export function resolveFolderPermissions(folders: FolderInput[], principals: PrincipalSet): FolderPermissionResolution {
  const effectiveBundles = computeEffectiveBundles(folders);
  const principalKeys = new Set([grantKey('user', principals.userId), ...principals.groupIds.map((g) => grantKey('group', g))]);

  const permittedRead: string[] = [];
  const permittedEdit: string[] = [];
  const permittedManage: string[] = [];
  const decidingGrant = new Map<string, DecidingGrant>();

  for (const folder of folders) {
    const bundle = effectiveBundles.get(folder.id)!;
    // Public read is the baseline; a matching named grant only overrides it when strictly higher-tier,
    // so a tie prefers the simpler "public" explanation in the deciding-grant preview (UI spec C3).
    let best: DecidingGrant | undefined = bundle.isPublic ? { tier: 'read', via: 'public' } : undefined;

    for (const grant of bundle.grants) {
      if (!principalKeys.has(grantKey(grant.principalType, grant.principalId))) continue;
      if (!best || tierRank(grant.access) > tierRank(best.tier)) {
        best = { tier: grant.access, via: { principalType: grant.principalType, principalId: grant.principalId } };
      }
    }

    if (!best) continue;
    decidingGrant.set(folder.id, best);
    permittedRead.push(folder.id);
    if (tierRank(best.tier) >= tierRank('edit')) permittedEdit.push(folder.id);
    if (tierRank(best.tier) >= tierRank('manage')) permittedManage.push(folder.id);
  }

  return { permittedRead, permittedEdit, permittedManage, decidingGrant };
}

/**
 * ADR-0005 "Widening detection" (amended 2026-07-19): per folder, whether its
 * effective read-audience is broader than its immediate parent's — a
 * transparency signal for anyone browsing the tree, independent of who's
 * asking. Same input contract as resolveFolderPermissions: the full tenant
 * folder list.
 */
export function computeFolderWidening(folders: FolderInput[]): Map<string, FolderWideningInfo> {
  const effectiveBundles = computeEffectiveBundles(folders);
  const result = new Map<string, FolderWideningInfo>();

  for (const folder of folders) {
    if (!folder.parentId) {
      result.set(folder.id, { broaderThanParent: false, addedGroups: [], becamePublic: false });
      continue;
    }

    const ownKeys = readPrincipalKeys(effectiveBundles.get(folder.id)!);
    // Unlike folder.id (always a real input folder, always cached by the loop in
    // computeEffectiveBundles), folder.parentId can itself be a dangling reference that never got
    // cached (resolve()'s orphan branch returns early without a cache write) — fall back to the same
    // deny-all bundle rather than a non-null assertion that would crash on a legitimately-missing key.
    const parentKeys = readPrincipalKeys(effectiveBundles.get(folder.parentId) ?? ORPHAN_BUNDLE);
    // A public parent's audience is already "everyone" — no named grant on a child can be broader
    // than that, even though its principal key literally differs from '*'.
    const addedKeys = parentKeys.has('*') ? [] : [...ownKeys].filter((key) => !parentKeys.has(key));

    result.set(folder.id, {
      broaderThanParent: addedKeys.length > 0,
      addedGroups: addedKeys.filter((key) => key.startsWith('group:')).map((key) => key.slice('group:'.length)),
      becamePublic: addedKeys.includes('*'),
    });
  }

  return result;
}
