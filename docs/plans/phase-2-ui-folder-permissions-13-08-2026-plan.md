# Phase 2 UI — Folder tree, permission management, groups — 2026-08-13

**Status:** DONE (2026-08-15). All 8 tasks complete on branch `phase-2-ui-folder-permissions` (off `main@a55f580`); full workspace check (`build lint test:unit test:integration`) 32/32 green. Not yet merged to `main` — awaiting explicit go-ahead. See Task 8 note at the end of this file for the closing review/merge-readiness summary.

**Scope:** `docs/plans/implementation-phases-11-07-2026-plan.md`'s Phase 2 items 2.6 (UI) and 2.7 (tests),
narrowed to the folder/group management surface that `docs/plans/phase-2-folder-group-management-12-08-2026-plan.md`
just built the backend for: folder-tree navigation, C3 folder permissions, C2 groups, and a read-only
document list inside a folder. **Explicitly excludes** drag-drop upload with progress, OCR engine
choice, quota-gate UX, document version history, and the processing queue (UI spec B3/B4/B5) — those
depend on the ingestion/OCR pipeline UX, are a separate large initiative, and get their own follow-on
plan. This was a deliberate scoping decision (the user chose it explicitly over building the full B2/B4
bundle in one plan) — see the session that authored this plan for the reasoning.

**Sources:** `docs/ui/screens_spec_v01.md` (B1 nav, B2 folder-tree portion, C2, C3), `docs/adr/0005-rbac-folder-permissions.md`,
`docs/test_plan_v01.md` §3.3–3.4 (permission-matrix tests), the just-merged `FoldersController`/`GroupsController`
(`apps/api/src/folders/`, `apps/api/src/groups/`).

## What already exists (verified by reading the code, not assumed)

- **Backend API is complete**: `FoldersController` (list/tree with widening badges, detail with
  manage-tier-gated grants, create/rename/move/delete, grant/revoke/reset-to-inherited/set-public,
  effective-permission preview) and `GroupsController` (create, list/detail with membership withheld
  below admin/member, membership add/remove, delete-when-unreferenced). All merged to `main` (`b36d11b`).
- **`apps/web`** has an RTL Next.js App Router shell (`app/layout.tsx`, `dir="rtl"`, `lang="he"`), a
  working session-cookie auth flow (`lib/api.ts`'s `tenantApi.get`/`.post`, both `credentials: 'include'`),
  and a home shell (`app/home/page.tsx`) with a static, unlinked "תיקיות" (Folders) nav item — the exact
  hook point for this plan's screens. `@kms/contracts` is already a dependency, so folder/group DTO types
  can be imported directly rather than re-declared.
- **No frontend test harness exists yet** (`apps/web`'s `test:unit` script is `jest --passWithNoTests` —
  confirmed via `package.json`, no test files anywhere in `apps/web`). This plan is the first real
  frontend test suite in the repo.
- **Gap found while planning, not previously known**: there is no route anywhere to list the documents
  inside a folder. `DocumentsController` has upload/download/delete/restore/purge/versions but no `GET`
  list route; `DocumentsRepository.findByFolder()` exists and is already used internally by
  `FoldersController.remove()`'s non-empty check, but nothing exposes it to a caller. Task 1 below closes
  this — without it, the folder browser could show folders but never what's inside them.
- **No live MongoDB Atlas connection in this sandbox** (unchanged from every prior phase) — the same
  constraint that limited Phase 1's Playwright pass to an unreachable-API smoke test. Task 7 addresses
  this differently than Phase 1 did: it builds a small local dev harness reusing Phase 2A's
  `mongodb-memory-server`/`ioredis-mock` test infrastructure to boot a real (if ephemeral) API instance,
  so the golden-path Playwright pass can exercise real data instead of just checking that an unreachable
  backend produces the right error copy.

## Tasks

### Task 1 — Backend prerequisite: list documents in a folder

`GET /folders/:id/documents` in `DocumentsController` (not `FoldersController` — matches the existing
convention that document operations live in `DocumentsController`, folder operations in
`FoldersController`). Permission-gated via `DocumentsPermissionsService.canRead(folderId)` (existing,
already used by `download()`), 404 on denial (never 403, sec §3.2). Returns
`{id, name, latestVersionNumber, sizeBytes, createdAt, createdBy}[]` — enough for a basic list, no
status-chip/processing-state fields (that's B3/B5 scope, out of bounds here per this plan's own
exclusion). Unit tests: 404 on non-readable folder, 404 on nonexistent folder, returns the folder's
documents for a readable folder, empty array for an empty folder.

### Task 2 — `apps/web/lib/api.ts`: extend the HTTP client

`tenantApi` currently only has `get`/`post`. Add `patch`/`del` (rename/move/setPublic use PATCH; revoke
grant/delete folder/delete group use DELETE) plus a query-string helper for `GET` calls that take
params (`list(parentId)`, `list(groups)` don't need one, but `effective-permission?userId=` does). Small,
mechanical, no new test framework needed yet (covered by Task 7's frontend tests once they exist).

### Task 3 — Folder tree navigation + document list (B2's folder-tree portion)

New route tree under `apps/web/app/folders/`: `/folders` (roots) and `/folders/[id]` (a folder's
children + its documents, via Task 1's new route). Breadcrumb from `path` (folders already carry it).
Actions gated by the summary's own `tier` field returned by the API (`read`/`edit`/`manage`) — create
requires `edit` on the current folder (or admin at root), rename/move/delete require `manage`; the UI
hides actions the tier doesn't allow, but every action still round-trips through the real API check
(never trust the client-side gate as the security boundary — matches this codebase's existing "denied
folders simply don't appear" convention, sec §3.2). Widening badge (`broaderThanParent`/`addedGroups`/
`becamePublic`) rendered per the UI spec's "visible to any user who can read the folder, no admin role
required" rule. Move: confirm dialog stating "this re-applies destination permissions" (UI spec B2's own
requirement). Document rows: name/size/version/created, download link (existing signed-URL endpoint,
unchanged).

### Task 4 — C3 Folder permissions screen

Manage-tier only (mirrors the backend's own gate — `FoldersController.detail()` already withholds the
`grants` array below manage tier, so a non-manage user hitting this screen simply gets no grants data
to render, not a separate access check to build). Grant list (principal type/id/access), add grant
(user or group, by id — no user/group picker/search exists yet since C1/C2 aren't built as searchable
directories; a raw id field is the honest MVP here, flagged as a known UX gap, not silently smoothed
over), revoke grant, `isPublic` toggle, reset-to-inherited. Effective-permission preview ("why can Dana
see this?") — target-user-id input, shows resolved tier + deciding grant, matches
`GET /folders/:id/effective-permission`'s known limitation (target-admin's real access via caller-side
bypass isn't modeled) — surfaced as a note in the UI, not hidden.

### Task 5 — C2 Groups screen

List/detail (membership shown per the backend's own withholding rule — admin or member only, matching
`GroupsController.toSummary()`), create group (admin-only route — UI hides the create action for
non-admins, same client-side-hide/server-side-enforce split as Task 3), membership add/remove
(admin-only), delete (admin-only, surfaces the `GROUP_IN_USE` 409 body's message when blocked).

### Task 6 — Wire into the home shell

`app/home/page.tsx`'s static "תיקיות" span becomes a real link to `/folders`; admins additionally get a
link to `/groups` next to the existing "ניהול משתמשים" (user management) label — no user-management
screen link exists there yet either (C1 isn't built), so this establishes the pattern for a future admin
section rather than building a full admin nav.

### Task 7 — Testing

1. **Permission-matrix integration suite** (server-side, populates 2.7's stated target — the still-
   skeleton `test/cross-tenant/` harness): inheritance, override-not-merge, `isPublic`, widening
   detection, cross-tenant 404s, non-member-group 404s — reusing Phase 2A's `mongodb-memory-server`/
   `ioredis-mock` harness (`apps/api/test/support/`), not a new one.
2. **Local dev harness for real browser testing**: a small script (`apps/api/test/dev-server.ts` or
   similar, reusing the same `mongodb-memory-server`/`ioredis-mock` pieces from (1)) that boots a real
   `apps/api` instance against ephemeral-but-real data, seeded with a tenant/user/folder tree/group —
   specifically so this plan's own "test the golden path in a browser" obligation can be met with actual
   data instead of Phase 1's "confirmed against an unreachable backend" fallback.
3. **Playwright pass** against (2)'s harness: login → folders → browse tree → view widening badge →
   grant permission → see it reflected → create group → add member → confirm in effective-permission
   preview. This is the golden-path check this plan's own frontend work must pass before Task 8 can
   claim it's verified, not optional polish.

### Task 8 — Final whole-branch review + finish

Same shape as the backend plan's own Task 7: `/code-review main...<branch> --level medium`, triage
findings directly against the code (not the review's own summary — this lesson has held twice now),
apply justified fixes, re-verify with the full workspace check, update
`implementation-phases-11-07-2026-plan.md` (2.6/2.7 → DONE) and this plan's own status header, update
the SDD ledger, report merge-readiness. Merging to `main` is the user's call, not made unilaterally.

## Explicitly out of scope (carried forward or new)

- Drag-drop upload, OCR engine choice, quota-gate UX, version history, processing queue (B3/B4/B5) —
  separate follow-on plan.
- C1 (user management UI), C4 (recycle bin UI), search/chat (B6/B7) — untouched, pre-existing gaps.
- A real user/group picker (search-as-you-type) for the grant-add flow — Task 4 uses a raw id field.
- Dark mode, mobile drill-down layout (UI spec open questions 1/2) — not decided yet, not blocking.
- Full live-Atlas verification — Task 7.2's harness is real Mongo/Redis, but still ephemeral/local, not
  Atlas; the CLAUDE.md-documented "never run against production-shaped data" caveat still applies.

## Task 8 closing note (2026-08-15)

Launched `/code-review main...phase-2-ui-folder-permissions --level medium` as a forked background
review dispatching parallel per-angle sub-agents (removed-behavior audit, cross-file call-site tracer,
reuse/duplication scan, simplification scan, efficiency scan, altitude/bandaid scan, CLAUDE.md
conventions check). **The review did not complete**: the account hit its monthly API spend limit
mid-run, and every angle except one returned `"You've hit your monthly spend limit"` with no findings.
Retrying was not attempted — this is an account-level cap, not a transient failure a retry would clear.

The one angle that finished before the limit hit — a removed/narrowed-behavior audit diffing against
the pre-change code — surfaced one real, verified issue:

**Authorization gap in `FolderSummary.path` (fixed, commit `f7c7278`):** Task 3's breadcrumb resolved
ancestor folder names from `folderNameLookup(allFolders)`, built from *every* folder in the tenant,
unfiltered by the caller's own `permittedRead`. Because permission resolution is override-not-merge
(ADR-0005), a folder can be independently readable via its own explicit grant while its ancestors are
not — every other field/route in `FoldersController` treats "no read access" as "no data, 404 only,"
and this one didn't: it disclosed an unreadable ancestor's name (and, via the web breadcrumb's link,
its existence — confirmed the link would itself 404 on click) to a caller who couldn't otherwise see it.
Fixed by filtering `folder.path` to `resolution.permittedRead` before resolving names, in both `list()`
and `detail()` (they share `toSummary()`). Two new regression tests added
(`folders.controller.spec.ts`) covering the exact scenario (a root/mid folder with no grants, a leaf
folder readable only via its own override) via both routes. Full workspace check re-verified 32/32 after
the fix (isolated `test:unit` 254/254, isolated `test:integration` 21/21 — the first combined run showed
spurious timeouts under CPU contention when integration tests ran alongside unit tests, the same class of
flake documented in the backend plan's own Task 1; isolated and re-combined runs confirmed clean).

**What did NOT get reviewed, because their agents never ran:** reuse/duplication across the new
`folders-api.ts`/`groups-api.ts` clients, simplification opportunities, efficiency (e.g. repeated
`findAllForTenant()` calls per request), "altitude"/band-aid-fix patterns, and CLAUDE.md convention
adherence. This plan's own code was still built and self-reviewed carefully task-by-task throughout
(each task's ledger entry above records self-caught corrections — the `ApiError#message` bug, the
`DecidingGrant` shape, the Groups-nav-admin assumption, the CORS middleware-ordering bug), but a
dedicated cross-cutting pass on those specific angles is genuinely missing, not just unreported.

**Merge-readiness:** code is correct and tested as far as it's been exercised (32/32 across build/lint/
unit/integration, plus a real Playwright browser pass), and the one concrete finding the partial review
did surface is fixed and covered by new tests. But this branch has **not** had the full multi-angle
review the backend-plan precedent (and this plan's own Task 8 text) called for — only 1 of ~7 angles
ran. Recommend either re-running `/code-review` once the spend limit resets, or accepting this as
sufficient given the task-by-task self-review discipline already applied. **Not merged to `main`** —
merging remains the user's explicit call, not made unilaterally, per standing instruction.
