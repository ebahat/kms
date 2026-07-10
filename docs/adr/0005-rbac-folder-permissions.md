# ADR-0005: RBAC — Folder Permissions and Effective-Permission Resolution

**Status:** Accepted (2026-07-10)
**Date:** 2026-07-10
**Deciders:** Product owner (Ehud); drafted in the architecture/ADR pass
**Sources:** PRD §7, §10, §13; sec §3.2, §3.3, §3.5; ADR-0001 (scope), ADR-0002 (retrieval pre-filter)

## Status

Accepted 2026-07-10 — step-6 consistency review passed; review fixes applied (findings record in the plan). Owns the cardinality-bound analysis flagged in the plan's risk register.

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

### Grant model (collections)

`folders` (ADR-0002) carries `grants: [{principalType: 'user'|'group', principalId, access: 'read'|'edit'}]`, `isPublic: boolean`, and `hasExplicitGrants: boolean`. Groups live in `groups` with member arrays (PRD §7). Grants are edited only via the admin permission endpoints (audited per PRD §12).

### Resolution algorithm (pure function, unit-testable)

Inputs: all tenant folders (`_id, path, grants, hasExplicitGrants, isPublic`), the user's principal set `{userId} ∪ groupIds`.

1. Sort folders by depth (root first).
2. Effective grant set of a folder = its own grants if `hasExplicitGrants`, else the effective set of its parent (**override, not merge** — PRD §7 "an explicit permission set on a subfolder overrides inheritance").
3. User's access to a folder = highest of: `edit` if any principal has edit, `read` if any has read, plus `read` if `isPublic` (PRD §7).
4. Output: `permittedRead: folderId[]`, `permittedEdit: folderId[]`.

The union-of-direct-and-group rule (PRD §7) is step 3; the inheritance-with-override rule is step 2. The same function serves the admin UI's "why can Dana see this?" preview (UI spec C3) by returning the deciding grant per folder.

### Consumption points

- **API authorization:** every document/folder route resolves the target's `folderId` and checks membership in `permittedRead`/`permittedEdit`; misses return **404** (sec §3.2). This is layered *on top of* the ADR-0001 tenant scope, never instead of it.
- **Retrieval pre-filter:** `buildScopedRetrievalQuery` (ADR-0002) receives `permittedRead` as `permittedFolderIds`. **Empty set ⇒ no Atlas call, no LLM call** — fail-closed grounding (sec §5.4).
- **Signed-URL issuance** (ADR-0006) and **citation click-through** (PRD §10) re-run the check at access time — satisfying sec §3.5's serve-time requirement even for cached chat answers.
- **Favorites listing** filters by `permittedRead` at read time — lost-access items hidden, not deleted (PRD §7).

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
- **Follow-ups:** Unit-test matrix for the resolution function (test plan §5); permission-propagation e2e (test plan §3.1); grant-group-token escape hatch noted in system-overview future list; ADR-0006 consumes `permittedRead` for signed-URL issuance.
