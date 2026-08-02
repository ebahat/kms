/**
 * Plain-data contract for the resolver (ADR-0005). Deliberately mongoose-free —
 * ids are strings so this package never needs `mongoose` (ADR-0001 confines
 * that import to libs/data); callers convert at the boundary (see adapters.ts).
 */

export type AccessTier = 'read' | 'edit' | 'manage';

const TIER_RANK: Record<AccessTier, number> = { read: 0, edit: 1, manage: 2 };

/** manage > edit > read (ADR-0005 "Access tiers", amended 2026-07-19). */
export function tierRank(tier: AccessTier): number {
  return TIER_RANK[tier];
}

export function tierAtLeast(candidate: AccessTier, required: AccessTier): boolean {
  return TIER_RANK[candidate] >= TIER_RANK[required];
}

export type PrincipalType = 'user' | 'group';

export interface FolderGrantInput {
  principalType: PrincipalType;
  principalId: string;
  access: AccessTier;
}

/**
 * One tenant folder as the resolver needs it. `parentId: null` marks a root
 * folder. `path`/timestamps/name etc. are irrelevant to authorization and
 * intentionally not part of this shape.
 */
export interface FolderInput {
  id: string;
  parentId: string | null;
  grants: FolderGrantInput[];
  /** true = grants (even if empty) + isPublic are authoritative here, not inherited (ADR-0005 step 2). */
  hasExplicitGrants: boolean;
  isPublic: boolean;
}

/** The querying user's principal set — themselves plus every group they belong to (PRD §7 union rule). */
export interface PrincipalSet {
  userId: string;
  groupIds: string[];
}

/** What decided a user's access to a folder — feeds the "why can Dana see this?" preview (UI spec C3). */
export type DecidingGrant =
  | { tier: AccessTier; via: 'public' }
  | { tier: AccessTier; via: { principalType: PrincipalType; principalId: string } };

export interface FolderPermissionResolution {
  /** Each array is a superset of the tier below it — every `permittedManage` id is also in `permittedEdit` and `permittedRead`. */
  permittedRead: string[];
  permittedEdit: string[];
  permittedManage: string[];
  /** folderId -> deciding grant. Folders with no access at all are omitted (not present with an empty/null entry). */
  decidingGrant: Map<string, DecidingGrant>;
}

/**
 * Per-folder "is this wider than its parent" flag (ADR-0005, amended 2026-07-19).
 * Viewer-independent — same for every user, unlike FolderPermissionResolution.
 */
export interface FolderWideningInfo {
  broaderThanParent: boolean;
  /** Group ids newly reachable here that a parent-effective read wouldn't grant. Individual users are deliberately excluded (ADR-0005). */
  addedGroups: string[];
  /** true iff this folder is public and its parent's effective grants are not. */
  becamePublic: boolean;
}
