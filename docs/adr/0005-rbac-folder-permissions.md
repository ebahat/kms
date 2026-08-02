# ADR-0005: RBAC — Folder Permissions and Effective-Permission Resolution

**Status:** Accepted (2026-07-10)
**Date:** 2026-07-10
**Deciders:** Product owner (Ehud); drafted in the architecture/ADR pass
**Sources:** PRD §7, §10, §13; sec §3.2, §3.3, §3.5; ADR-0001 (scope), ADR-0002 (retrieval pre-filter)

## Status

Accepted 2026-07-10 — step-6 consistency review passed; review fixes applied (findings record in the plan). Owns the cardinality-bound analysis flagged in the plan's risk register.

**Amended 2026-07-19** (implementation-phase requirements pass, `docs/requirements_v02.md` §7/§8): access tiers extended from two (read/edit) to three (read/edit/manage) — see §Decision below, "Access tiers" — because directory CRUD and direct-sharing requirements needed delete/move/re-permission separated from ordinary content edits. Direct sharing (internal share links + external token-only links) is a related but separate concern, specified in new ADR-0011, which consumes this ADR's resolver as its permission source for internal shares.

**Amended 2026-07-19 (cont.)** (owner decision on the "override widens access" open question raised in the requirements pass): the resolution algorithm now also flags, per folder, whether that folder's effective grants are **broader** than what its immediate parent's effective grants would give — i.e., an override folder has added a principal (user/group) that has no read access via the parent, or has flipped `isPublic` from false to true. This is exposed to any user who can already read the folder, not just tenant admins — see §Decision "Widening detection" and §Consumption points below.

## Context

The permission model itself is settled by PRD §7: read/edit per folder, grantable to users or groups; subfolders inherit unless an explicit set overrides; effective permission = union of direct and group grants; public folders readable tenant-wide; **changes take effect immediately** — retrieval, citation clicks, and downloads re-check at access time, favorites to lost items are hidden. Out-of-permission reads return 404, never 403 (sec §3.2).

What this ADR must decide is the **resolution strategy**: how a user's effective permitted-folder set is computed and delivered to (a) the API authorization check on every read/write, and (b) the `permittedFolderIds` array in the retrieval pre-filter (ADR-0002; sec §3.3). Constraints:

- Immediate propagation rules out any cache without an invalidation story (PRD §7; sec §3.5 "cached retrieval results must be permission-checked at serve time").
- The `$in` filter in both Atlas queries is bounded by the set's size — the plan's risk register requires a documented bound at 10× scale.
- Folder hierarchy: max depth 10 (PRD §8); `folders.path` materialized ancestor array exists per ADR-0002.
- Envelope: ~200 docs/tenant at MVP, 10× ⇒ ~2,000 docs/tenant; folders are an order of magnitude fewer than documents in normal use — assume ≤ 500 folders/tenant at 10× as the design bound (validated below).

## Options Considered

### Option A: On-read resolution, no cache

Every request walks the folder tree: load all tenant folders + grants, compute the user's effective set in memory, use it.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Lowest — one pure function, no invalidation |
| Propagation | Perfect — always current (PRD §7) |
| Cost/latency | One folders-collection read + O(folders) compute per request |
| 10× behavior | ≤ 500 folder docs per read — small, but on *every* API call and chat message |

- **Pros:** Zero staleness; trivially testable; no write-path fan-out.
- **Cons:** Redundant recomputation on hot paths (chat issues retrieval + citation checks per message); folders collection becomes a per-request dependency for every endpoint.

### Option B: Persistent materialized per-user permitted sets

A `userFolderAccess` collection stores each user's effective folder list; recomputed by a fan-out job on every permission/group/folder change.

| Dimension | Assessment |
|-----------|------------|
| Complexity | High — write-path fan-out, partial-failure handling |
| Propagation | **Asynchronous** — a fan-out window where revoked users still pass |
| Cost/latency | O(1) read |
| 10× behavior | 80k users × folders rows; group-membership change fans out to all members |

- **Pros:** Cheapest read path.
- **Cons:** The fan-out window violates "changes take effect immediately" (PRD §7) unless writes block on full fan-out — at which point a group change touching 400 users is a slow, failure-prone transaction. Materializing derived authorization state also creates a second source of truth to audit.

### Option C: On-read resolution + versioned Redis cache (chosen)

Option A's pure function, cached in Redis keyed by `{tenantId, userId, permVersion}`. `permVersion` is a per-tenant monotonic counter bumped **synchronously in the same operation** as any grant/group/folder-move/public-flag change. A version bump makes every cached set unreachable instantly — invalidation is implicit in the key.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — one counter, one cache key discipline |
| Propagation | Immediate — stale keys are never read again after the bump |
| Cost/latency | Redis hit on hot path; recompute (Option A cost) once per user per change |
| 10× behavior | Same bound as A on misses; hits otherwise |

- **Pros:** Read performance of B with the correctness of A; coarse per-tenant invalidation is deliberately conservative (a permission change recomputes all users of that tenant lazily — cheap at ≤ 500 folders); no derived authorization state persisted.
- **Cons:** Redis dependency on the authorization path (already true for sessions, ADR-0004); coarse invalidation causes brief recompute bursts after admin bulk edits — bounded and lazy.

**Decision: Option C.** B's asynchronous window is disqualifying against PRD §7; A is the semantics we want, C makes it cheap.

## Decision

### Access tiers (amended 2026-07-19: three, strictly ordered)

`manage > edit > read`. Originally two tiers (read/edit); split into three once directory CRUD and direct-sharing requirements needed "can delete/move/re-permission" separated from "can add content":

- **read** — browse the folder listing, view/download files.
- **edit** — read, plus upload new file versions and create new subfolders/files within the folder.
- **manage** — edit, plus delete/move/rename the folder or its contents, and change its permission grants. Deletion and re-permissioning always require `manage`, never `edit` alone (this is the one place the original two-tier model was ambiguous — `edit` never implies delete).

A principal's tier on a folder is a single value from this ordered set, never a bitmask — "highest wins" (step 3 below) means highest in this ordering.

### Grant model (collections)

`folders` (ADR-0002) carries `grants: [{principalType: 'user'|'group', principalId, access: 'read'|'edit'|'manage'}]`, `isPublic: boolean`, and `hasExplicitGrants: boolean`. Groups live in `groups` with member arrays (PRD §7); tenant admins manage group membership, but the role set itself (platform admin / tenant admin / tenant user) is fixed — groups are not a custom-role system (PRD §7). Grants are edited only via the admin/manage-tier permission endpoints (audited per PRD §12), and grants are individually added/removed — a file/folder is never reassigned to a different "owning" group (PRD §7).

### Resolution algorithm (pure function, unit-testable)

Inputs: all tenant folders (`_id, path, grants, hasExplicitGrants, isPublic`), the user's principal set `{userId} ∪ groupIds`.

1. Sort folders by depth (root first).
2. Effective grant set of a folder = its own grants if `hasExplicitGrants`, else the effective set of its parent (**override, not merge** — PRD §7 "an explicit permission set on a subfolder overrides inheritance").
3. User's access to a folder = highest tier of: any principal's granted tier, plus `read` if `isPublic` (PRD §7). "Highest" is the `manage > edit > read` ordering above.
4. Output: `permittedRead: folderId[]`, `permittedEdit: folderId[]`, `permittedManage: folderId[]` — each a superset of the tier above it (every `manage` folder is also in `permittedEdit` and `permittedRead`, etc.) so callers can check the tier they need directly.

The union-of-direct-and-group rule (PRD §7) is step 3; the inheritance-with-override rule is step 2. The same function serves the admin UI's "why can Dana see this?" preview (UI spec C3) by returning the deciding grant per folder.

### Widening detection (added 2026-07-19)

A folder with `hasExplicitGrants: true` (an override) may narrow, widen, or simply reshuffle its parent's effective grants — the algorithm above doesn't distinguish these, but the product requirement does: a **widened** folder (one whose audience grew relative to its parent) needs a visible warning, because a user who trusts "this is inside the Legal folder" can otherwise be misled about who else can now read what they store here.

Definition (per-level, not transitive up the whole ancestor chain — a folder is compared only to its immediate parent's *own* effective set, which already reflects that parent's ancestry): a folder's own `readPrincipals` = the set of `{userId}`/`groupId` granted `read` or higher by its own `grants`, plus `*` (everyone in tenant) if `isPublic`. `broaderThanParent = true` iff `readPrincipals(folder) ⊄ readPrincipals(parent's effective grants)` — i.e., at least one principal (or `*` via a false→true `isPublic` flip) can read this folder but could not read the parent through the parent's own effective grants. Tier escalation alone (same principals, higher tier) does **not** count as widening — the concern is audience size, not capability, so a folder that gives the *same* people `edit` instead of `read` is not flagged.

This is tenant-wide, viewer-independent metadata (unlike `permittedRead`, it doesn't depend on who's asking) — compute it once per tree walk alongside step 2–4 and cache it per `{tenantId, permVersion}` (same invalidation trigger as the permission cache, but no per-user dimension, so it's far cheaper to keep warm). Output per folder: `{broaderThanParent: boolean, addedGroups: groupId[]}` (the group-only diff — see Consumption points for why individually-granted users are excluded from this particular output).

### Consumption points

- **API authorization:** every document/folder route resolves the target's `folderId` and checks membership in `permittedRead`/`permittedEdit`/`permittedManage` (whichever the operation needs); misses return **404** (sec §3.2). This is layered *on top of* the ADR-0001 tenant scope, never instead of it.
- **Retrieval pre-filter:** `buildScopedRetrievalQuery` (ADR-0002) receives `permittedRead` as `permittedFolderIds`. **Empty set ⇒ no Atlas call, no LLM call** — fail-closed grounding (sec §5.4).
- **Signed-URL issuance** (ADR-0006) and **citation click-through** (PRD §10) re-run the check at access time — satisfying sec §3.5's serve-time requirement even for cached chat answers.
- **Favorites listing** filters by `permittedRead` at read time — lost-access items hidden, not deleted (PRD §7).
- **Direct sharing (ADR-0011)** consumes `permittedRead`/`permittedEdit`/`permittedManage` unchanged for internal share-link recipients — a share link is never a fourth access path, it only surfaces a resource a recipient can already reach through this same resolver, or (for external recipients) is resolved through ADR-0011's separate token mechanism instead of this one.
- **Folder browser widening badge (added 2026-07-19):** `GET` folder-listing/detail routes include `broaderThanParent` + `addedGroups` (group names, resolved from `groups`) for any folder already in the caller's `permittedRead` — this is a read-time projection of the same tree walk, not a new authorization path, so it needs no extra check beyond the existing 404-on-miss rule (sec §3.2). Scoped to **groups only**, not individually-granted users: naming a specific person as "why this folder is wider" would expose who has a personal grant on a folder to every other viewer of that folder, which is a narrower, more sensitive disclosure than "the Sales group can read this" — the badge answers "is this folder safe for what I'm about to upload," not "who exactly." Individually-granted users remain visible only in the tenant-admin C3 screen, unchanged.

### Data Flow (permission change propagation)

| Role | Actor | Channel |
|------|-------|---------|
| Initiator | Tenant admin (C3 screen) | HTTPS → grants update |
| Processor | Permissions service: update `folders.grants` + bump `permVersion` (same Mongo session) + audit event (PRD §12) | Mongo transaction |
| Return path | Next request from any affected user misses the cache → recompute → new behavior | Redis key miss (implicit) |
| Error path | Transaction failure ⇒ neither grants nor version change (no split state) | HTTP error to admin |

### Cardinality bound (plan risk register)

`$in` over `permittedFolderIds`: worst case = every folder readable ⇒ ≤ 500 ObjectIds at 10× (≈ 6 KB in the query). Atlas `$vectorSearch` filters and `$search` `in` clauses handle thousands of values; MongoDB's practical `$in` guidance is tens of thousands. **Bound: design holds to 2,000 folders/tenant (4× the 10× assumption) before query-size cost is even measurable.** Escape hatch if folder counts explode past that: stamp chunks with a small set of *grant-group tokens* (hash of the folder's effective grant set) and filter on tokens instead of folder ids — a chunk-schema addition (ADR-0002), pre-identified, not built now.

## Consequences

- **Positive:** Authorization is one pure function + one counter — easy to test exhaustively (inheritance/override/public/union matrix in unit tests; propagation in the cross-tenant suite, test plan §3.1); retrieval and API checks consume the same computation, so search can never disagree with the browser (PRD §10 vs §7 consistency).
- **Negative / accepted risks:** Per-tenant version bump recomputes all that tenant's users lazily — a bulk admin session invalidates repeatedly (accepted: recompute is ≤ 500-folder in-memory work); Redis outage degrades to Option A per-request recomputation (correct, slower) — the service must implement that fallback, not fail.
- **Follow-ups:** Unit-test matrix for the resolution function (test plan §5), now including the three-tier hierarchy; permission-propagation e2e (test plan §3.1); grant-group-token escape hatch noted in system-overview future list; ADR-0006 consumes `permittedRead` for signed-URL issuance; ADR-0011 (direct sharing links, internal + external) builds on this resolver; widening-detection unit-test matrix (root folder — no parent, always `false`; narrowing override; reshuffle-only override; tier-escalation-only override — must stay `false`; `isPublic` false→true flip) lands with 2.2 alongside the existing resolver tests; UI spec B2 needs the badge + group-list affordance (tracked there).
