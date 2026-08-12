# Phase 2 — Folder/Group Management API (backend) — 2026-08-12

**Status:** DRAFT (revised 2026-08-12 after a verification pass against the actual code — see
"Revision note" below). Not yet executed.

**Scope:** the actual remaining backend gap in Phase 2 (`docs/plans/implementation-phases-11-07-2026-plan.md`),
found by audit on 2026-08-12: `FoldersController` and `GroupsController` do not exist anywhere in
`apps/api`, despite the full ADR-0005 permission-resolution library and `DocumentsPermissionsService`
already existing and working. This plan builds the management API surface those pieces were designed
to sit behind. **UI (2.6) and the permission-matrix/cross-tenant/signed-URL integration test suite
(2.7) are explicitly deferred to a follow-on plan** — this plan covers backend + unit tests only,
matching how Phase 2A sequenced its own backend-then-integration-tests-then-UI-spec split.

**Sources:** `docs/adr/0005-rbac-folder-permissions.md`, `docs/adr/0006-file-storage-and-serving.md`,
`docs/requirements_v02.md` §7, `docs/ui/screens_spec_v01.md` B2/C2/C3 (informs response shapes, not
built here).

## Revision note (what the verification pass changed)

The first draft flagged three things as "check the code before assuming." All three were checked; the
answers materially changed the plan:

1. **Widening detection is already fully built _and_ cached** — `computeFolderWidening()` plus
   `computeFolderWideningCached()` (`libs/permissions/src/permission-cache.ts:110-132`), with its own
   `{tenantId, permVersion}` cache key, a `becamePublic` field, and the subtle "a public parent's
   audience is already everyone, so no child can be broader" case handled
   (`resolve-permissions.ts:133`). The read-routes task shrank from "may need to build this" to pure
   wiring.
2. **A dangling `parentId` silently breaks permission resolution for an entire tenant.** This is now
   Task 1, a prerequisite for every route that can create or move a folder. Detail in that task.
3. **The repositories have none of the needed mutation methods** — `FoldersRepository` has only
   `findAllForTenant`/`findChildren`/`createFolder`; `GroupsRepository` has only
   `findAllForTenant`/`findForMember`. Every write path below adds its own.

Also added since the first draft: an HTTP error-mapping step (the existing domain errors map to
nothing and would surface as 500s), an explicit decision on revoke-the-last-grant semantics, and an
`isPublic` mutation route — all three were missing entirely.

**Process note (carried over, from Phase 2A's Task 11 review):** that review found the Events/Tasks/
Calendar controllers had zero runtime request-body validation, unlike `AuthController`/`DocumentsController`'s
zod pattern (`libs/contracts/src/*-dto.ts` + `SomeRequestSchema.parse(body)`). Every route below uses
that pattern from the start, and every route gets at least one test proving its schema **rejects** a
bad body — not just that the happy path validates.

## Task list overview

1. **Folder data-integrity hardening** (prerequisite — prevents a tenant-wide outage)
2. Contracts: zod schemas for folder/group requests
3. `FoldersController` — read routes (list/tree, detail, widening badge)
4. `FoldersController` — write routes (create/rename/move/delete) + domain-error HTTP mapping
5. `FoldersController` — grants, `isPublic`, inheritance reset, `permVersion` wiring, effective-permission preview
6. `GroupsController` — CRUD + membership
7. Final whole-branch review + finish

Per-task coverage discipline (cross-tenant 404s, permission-miss 404s, admin-only rejections, invalid-body
400s) lives inside each task's own TDD step — the first draft's separate "audit your own specs" task was
dropped as busywork.

---

## Task 1: Folder data-integrity hardening (do this first)

**Why this is first:** `FoldersRepository.createFolder` (`libs/data/src/repositories/folders.repository.ts:29-33`)
resolves the parent through the tenant-scoped `findById`. When the parent doesn't exist — nonexistent
id, or a **valid id belonging to another tenant** — it silently sets `path = []` **but still stores the
caller-supplied `parentId`**. That row is then a landmine:

- `computeEffectiveBundles` (`libs/permissions/src/resolve-permissions.ts:36-40`) **throws** when any
  folder references a parent that isn't in the input set.
- `resolveFolderPermissionsCached` does **not** catch it — its `try/catch` blocks wrap only the Redis
  calls; the `resolveFolderPermissions(...)` call at `permission-cache.ts:101` is bare.
- `DocumentsPermissionsService.hasAccess` doesn't catch it either.

Net effect: **one bad folder create permanently breaks every permission check for every user in that
tenant** — browse, upload, download, delete — until the row is manually repaired. `computeFolderWidening`
shares the same helper, so the widening path dies with it. The identical failure mode exists for a
**move that creates a cycle** (cycle detector throws at `resolve-permissions.ts:42`).

This is latent today only because no route can create or move a folder. **Tasks 4 and 5 are exactly
what make it reachable**, so it gets fixed before them, not alongside them.

**Files:**
- Modify: `libs/data/src/repositories/folders.repository.ts` / `.spec.ts`
- Modify: `libs/permissions/src/resolve-permissions.ts` / `.spec.ts`

- [ ] **Step 1: Prevent bad data at the source.** `createFolder` must reject a non-null `parentId`
  that doesn't resolve inside the tenant, rather than silently degrading to `path = []`. Add a
  `FolderParentNotFoundError` to `libs/data/src/errors.ts` alongside the existing folder errors
  (Task 4 maps it to a 404). Do **not** rely on the controller alone for this — the repository is the
  invariant's owner, and a future second caller must not be able to reintroduce the landmine.

- [ ] **Step 2: Contain the blast radius (defense in depth).** Decide and implement how the resolver
  behaves when a folder's parent is genuinely absent from the input. **Recommended: fail closed per
  folder, not per tenant** — treat an orphaned folder (and its subtree) as inaccessible, exclude it
  from every permitted set, and keep resolving the rest of the tree.

  Rationale for the change, and the argument against it, both recorded because this is a real
  tradeoff: the current throw is a deliberate loud signal for the documented caller contract
  ("callers must pass the full tenant folder list"), and silencing it could mask a genuine caller bug.
  But the function cannot distinguish a caller bug from a corrupt row, and the cost of guessing wrong
  is asymmetric — a caller bug surfaces immediately in tests and dev, whereas a corrupt row in
  production currently takes down an entire tenant's access. Fail-closed-per-folder loses no security
  (an orphan grants nothing) and converts a tenant outage into one unreachable folder. If the
  implementer disagrees after reading both functions, keep the throw and say so in the task report —
  but then Step 1 becomes load-bearing on its own and needs a migration/repair story for any row that
  slips through.

  Whichever way this goes: cycles keep throwing (a cycle is unambiguously a bug, and there is no
  meaningful fail-closed interpretation of one).

- [ ] **Step 3: Tests.** Repository: rejects a nonexistent parentId; rejects a cross-tenant parentId
  (the sharper case — a *valid* ObjectId from another tenant). Resolver: an orphaned folder doesn't
  throw and doesn't appear in any permitted set, while its unaffected siblings resolve normally.

- [ ] Step 4: `pnpm turbo run build lint test:unit`; commit.

```bash
git add libs/data/src/repositories/folders.repository.ts libs/data/src/repositories/folders.repository.spec.ts \
  libs/data/src/errors.ts libs/permissions/src/resolve-permissions.ts libs/permissions/src/resolve-permissions.spec.ts
git commit -m "fix: reject dangling folder parentId and contain orphan blast radius in permission resolution"
```

---

## Task 2: Contracts — folder/group request DTOs

**Files:**
- Create: `libs/contracts/src/folder-dto.ts`, `libs/contracts/src/group-dto.ts`
- Modify: `libs/contracts/src/index.ts`

Mirror `libs/contracts/src/document-dto.ts`'s shape exactly (`z.object`, one `z.infer` type export per
schema):

```typescript
// folder-dto.ts
export const CreateFolderRequestSchema = z.object({
  parentId: z.string().nullable(),           // null = root
  name: z.string().trim().min(1).max(255),
});
export const RenameFolderRequestSchema = z.object({ name: z.string().trim().min(1).max(255) });
export const MoveFolderRequestSchema   = z.object({ parentId: z.string().nullable() });
export const SetFolderPublicRequestSchema = z.object({ isPublic: z.boolean() });

export const FolderGrantRequestSchema = z.object({
  principalType: z.enum(['user', 'group']),
  principalId: z.string(),
  access: z.enum(['read', 'edit', 'manage']),
});
export const RevokeFolderGrantRequestSchema = z.object({
  principalType: z.enum(['user', 'group']),
  principalId: z.string(),
});

// group-dto.ts
export const CreateGroupRequestSchema = z.object({ name: z.string().trim().min(1).max(255) });
export const UpdateGroupMembersRequestSchema = z.object({
  add: z.array(z.string()).default([]),
  remove: z.array(z.string()).default([]),
});
```

- [ ] Step 1: Write + export the schemas. Don't duplicate `createFolder`'s cardinality/depth-bound
  logic here — that stays in the repository.
- [ ] Step 2: `pnpm --filter @kms/contracts build`; commit.

```bash
git add libs/contracts/src/folder-dto.ts libs/contracts/src/group-dto.ts libs/contracts/src/index.ts
git commit -m "feat: folder/group request DTOs (zod)"
```

---

## Task 3: `FoldersController` — read routes

**Files:**
- Create: `apps/api/src/folders/folders.controller.ts` / `.spec.ts`
- Modify: `apps/api/src/app.module.ts` (register the controller — `FoldersRepository`, `GroupsRepository`
  and the `PERMISSION_CACHE` token are already registered providers; copy `DocumentsPermissionsService`'s
  DI pattern rather than inventing one)

**Interfaces:**
- Consumes: `FoldersRepository.findAllForTenant`/`.findChildren`/`.findById`;
  `resolveFolderPermissionsCached` **and** `computeFolderWideningCached` from `@kms/permissions`
  (both already exist and are already cached — this is wiring, not new logic).
- Produces: `GET /folders?parentId=` (children of `parentId`, or roots when omitted),
  `GET /folders/:id`.

**Behavior (ADR-0005 §Consumption points, §Widening detection):**
- Results are filtered to the caller's `permittedRead`. A folder outside it is simply absent from the
  list; `GET /folders/:id` on one returns **404**, same as a nonexistent id (sec §3.2 — never 403).
- Each folder returns: `id`, `name`, `parentId`, `hasExplicitGrants`, `isPublic`, the caller's own
  effective tier, and `broaderThanParent`/`addedGroups`/`becamePublic` from the widening map.
  `addedGroups` must be resolved to group **names** for display (ADR-0005's badge is group-scoped by
  design — never surface individually-granted users here; that's C3-admin-only).
- `GET /folders/:id` additionally returns the raw `grants` array **only** when the caller has `manage`
  on that folder — the C3 screen's data, withheld from `read`/`edit` viewers per ADR-0005.

- [ ] Step 1: Implement both routes, TDD against the spec (mock the repositories + `PermissionCache`,
  same style as `documents.controller.spec.ts`). Include: a folder outside `permittedRead` is absent
  from the list; the same folder 404s on detail; `grants` is withheld below `manage` tier.
- [ ] Step 2: Register in `app.module.ts`; run the `apps/api` unit suite; commit.

```bash
git add apps/api/src/folders/folders.controller.ts apps/api/src/folders/folders.controller.spec.ts apps/api/src/app.module.ts
git commit -m "feat: FoldersController read routes (permission-scoped list/detail + widening badge)"
```

---

## Task 4: `FoldersController` — write routes + domain-error HTTP mapping

**Files:**
- Modify: `apps/api/src/folders/folders.controller.ts` / `.spec.ts`
- Modify: `libs/data/src/repositories/folders.repository.ts` (add `renameFolder`, `moveFolder`)
- Create: `apps/api/src/folders/folder-exception.filter.ts` / `.spec.ts`

**Produces:** `POST /folders`, `PATCH /folders/:id` (rename), `PATCH /folders/:id/move`,
`DELETE /folders/:id`.

**Authorization (ADR-0005 "Access tiers"):**
- **Create** — `edit` on the parent. `parentId: null` (root) requires tenant-admin, since there's no
  parent to hold a grant; reject non-admins with a clear 403, not a 404 (this isn't a hidden-resource
  case — the user knows roots exist). **Validate parent existence explicitly** (Task 1 hardened the
  repository; the controller still maps the failure to a clean 404 rather than letting a 500 escape).
  Note that a tenant-admin bypasses the tier check entirely, so the tier check alone never validates
  the parent — this is exactly the hole Task 1 closes.
- **Rename** — `manage` on the folder.
- **Move** — `manage` on the folder **and** `edit` on the destination parent (you shouldn't be able to
  move a folder somewhere you can't add content). Must reject: exceeding `MAX_FOLDER_DEPTH` *counting
  the moved subtree's own height*, and any move into the folder's own descendant (cycle → see Task 1
  for why this is not optional).
- **Delete** — `manage`. **Deliberate MVP scope cut:** reject with a clear error when the folder has
  any subfolder or any document. No folder-level recycle bin, no cascade delete — ADR-0006's deletion
  machinery is document-scoped and there is no folder-level equivalent designed. Record this as an
  explicit cut in the task report, not a silent gap.

- [ ] **Step 1: `moveFolder` is the hard part** — moving a folder must rewrite `path` for the folder
  **and every descendant**. No such method exists (`createFolder` computes `path` from a fresh parent
  lookup, which does not generalize to re-parenting a subtree). Write it first, with a dedicated test
  asserting a 3-level subtree's descendants all get corrected paths.
- [ ] **Step 2: Exception filter.** `FolderLimitExceededError`, `FolderDepthExceededError` and Task 1's
  `FolderParentNotFoundError` are currently caught by **nothing** — verified by grep, they appear only
  in the repository and its spec, so they'd surface as raw 500s with no useful body. Map them
  (409 / 400 / 404 respectively) following the existing `MulterExceptionFilter` precedent
  (`apps/api/src/documents/multer-exception.filter.ts`): a `@Catch`-scoped filter applied via
  `@UseFilters` on this controller, not a global filter.
- [ ] Step 3: TDD all four routes, including every rejection case above.
- [ ] Step 4: Full `apps/api` unit suite; commit.

```bash
git add apps/api/src/folders/ libs/data/src/repositories/folders.repository.ts libs/data/src/repositories/folders.repository.spec.ts
git commit -m "feat: FoldersController write routes (create/rename/move/delete) + domain-error mapping"
```

---

## Task 5: Grants, `isPublic`, inheritance reset, `permVersion` wiring, effective-permission preview

**Files:**
- Modify: `apps/api/src/folders/folders.controller.ts` / `.spec.ts`
- Modify: `libs/data/src/repositories/folders.repository.ts` (grant/isPublic mutation methods)

**Produces:** `POST /folders/:id/grants` (add/update), `DELETE /folders/:id/grants` (revoke),
`POST /folders/:id/grants/inherit` (reset to inherited), `PATCH /folders/:id/public` (toggle
`isPublic`), `GET /folders/:id/effective-permission?userId=`.

All mutating routes require `manage` on the folder. All of them bump `permVersion` and write an
`auditEvents` entry (ADR-0005 §Data Flow).

**The `hasExplicitGrants` semantics — get this exactly right, it's a silent-widening hazard:**

`resolve-permissions.ts:46` — a folder inherits **only** when `hasExplicitGrants` is false. Therefore:

- **Adding** the first grant to an inheriting folder must flip `hasExplicitGrants` to `true` in the
  same write, or the resolver ignores the new grant entirely and the grant appears to do nothing.
- **Revoking** the last grant must **not** flip it back to `false`. Per the schema comment and
  ADR-0005, `true` + empty grants means *"authoritative, deny-all"*, which is a genuinely different
  state from inheriting. Auto-reverting would silently convert a deliberate lockdown into "inherit
  the parent's audience" — a silent permission **widening**, precisely the hazard ADR-0005's widening
  badge exists to make visible.
- Because of the above, resuming inheritance needs its **own explicit route** (`/grants/inherit`:
  clears `grants` *and* sets `hasExplicitGrants: false`). This is a widening-capable operation in its
  own right — bump + audit it like any other.

**`permVersion` wiring** (`PermissionCache.bumpVersion`, `permission-cache.ts:51` — already
implemented, currently dead code; this task is its first real caller): ADR-0005 specifies the bump
happens in the same operation as the write. This codebase uses no Mongo transactions anywhere, so a
true same-transaction guarantee needs infrastructure that doesn't exist. **Ordering rule if a
transaction isn't feasible: write the grant first, bump second.** Grant-written-but-bump-failed is
safe (a stale cache means late propagation, self-healing on the next bump or TTL). The reverse —
bumping before the write commits — lets a fresh cache entry be built from *pre-change* data and then
be treated as current, which is the genuinely dangerous ordering. Record whichever ordering ships,
and its accepted-risk window, in the task report.

**`effective-permission` preview** — `manage`-tier only (C3's "why can Dana see this?"). Reuse the
resolver's existing `DecidingGrant` output (`libs/permissions/src/types.ts`); don't invent a shape.

- [ ] Step 1: Repository methods for grant add/revoke/inherit-reset and `isPublic`, each keeping
  `hasExplicitGrants` consistent per the rules above.
- [ ] Step 2: TDD the routes. Required cases: first-grant flips `hasExplicitGrants`; revoking the last
  grant leaves it `true` (deny-all preserved); `/grants/inherit` clears both; every mutation bumps
  `permVersion` exactly once with the tenantId **from CLS scope, never from request input**; every
  mutation writes an audit event.
- [ ] Step 3: `effective-permission` route; TDD.
- [ ] Step 4: Full `apps/api` unit suite; commit.

```bash
git add apps/api/src/folders/ libs/data/src/repositories/folders.repository.ts libs/data/src/repositories/folders.repository.spec.ts
git commit -m "feat: folder grants, isPublic, inheritance reset, permVersion invalidation, effective-permission preview"
```

---

## Task 6: `GroupsController` — CRUD + membership

**Files:**
- Create: `apps/api/src/groups/groups.controller.ts` / `.spec.ts`
- Modify: `libs/data/src/repositories/groups.repository.ts`, `apps/api/src/app.module.ts`

**Produces:** `POST /groups`, `GET /groups`, `GET /groups/:id`, `PATCH /groups/:id/members`,
`DELETE /groups/:id`.

**Authorization:** create/membership-edit/delete are tenant-admin-only via the existing
`AdminOnlyGuard` (verified reusable; its 403 is consistent with the precedent already set by
`DocumentsController`'s recycle-bin routes and `TenantUsersAdminController` — the 404-not-403 rule
governs hidden *resources*, not admin-only *actions*). `GET` list/detail is open to any authenticated
tenant user: group names existing isn't the sensitive part, and their contents stay gated by their own
controllers. Revisit if that reasoning doesn't hold up against PRD §7 on a closer read.

- [ ] **Step 1: Atomic membership updates.** `GroupsRepository` has no create/membership methods —
  only the inherited `ScopedRepository.create`/`.updateOne`. Add `addMembers`/`removeMembers` using
  `$addToSet`/`$pull`, **not** a read-modify-write `$set` of the whole `memberUserIds` array, which
  would silently drop concurrent edits.
- [ ] **Step 2: Membership changes affect permission resolution** — a user's group membership is an
  input to their principal set, so add/remove must bump `permVersion` and audit, exactly like a folder
  grant change (ADR-0005 lists group changes as a bump trigger alongside grant changes). Easy to miss
  because it lives in a different controller than Task 5's grants.
- [ ] **Step 3: Delete-in-use rejection.** Reject deletion when the group holds any folder grant, or
  owns any calendar event or kanban task (same reject-don't-cascade posture as folder delete). One
  test per referencing entity type. Note the asymmetry with folders: a dangling *group* reference in a
  grants array does **not** throw the resolver (it just never matches a principal), so this is orphan
  hygiene rather than an outage risk — worth doing, but not the same severity as Task 1.
- [ ] Step 4: TDD all five routes; register in `app.module.ts`; full `apps/api` unit suite; commit.

```bash
git add apps/api/src/groups/groups.controller.ts apps/api/src/groups/groups.controller.spec.ts \
  libs/data/src/repositories/groups.repository.ts libs/data/src/repositories/groups.repository.spec.ts apps/api/src/app.module.ts
git commit -m "feat: GroupsController CRUD + atomic membership management"
```

---

## Task 7: Final whole-branch review + finish

Mirrors Phase 2A's Task 11.

- [ ] Step 1: Full-branch review (`/code-review main...<branch>`). **Use `--level medium`** — Phase 2A's
  `--level high` run stalled for 90+ minutes re-verifying the diff and had to be killed, and the
  medium run found four real, confirmed issues in ~16 minutes.
- [ ] Step 2: Triage findings **against the actual code**, not by trusting the reviewer's verdict
  channel — Phase 2A's run also had its final report collapse to a single "." twice, and the findings
  had to be recovered from the run transcript.
- [ ] Step 3: Apply justified fixes; re-run the full workspace check.
- [ ] Step 4: Update `docs/plans/implementation-phases-11-07-2026-plan.md`'s Phase 2 checklist
  (2.1b/2.2b → DONE) and this plan's status header.
- [ ] Step 5: Report merge-readiness. Merging is the user's call, same as Phase 2A.

---

## Explicitly out of scope (deferred to a follow-on plan)

- **2.6 UI** — folder browser, upload progress, permission-management and group screens (B2/C2/C3).
  Needs this plan's API to exist first.
- **2.7 integration tests** — the permission-matrix suite (inheritance/override/public/widening),
  populating the still-empty `test/cross-tenant/` harness, signed-URL expiry/tamper tests. Per-task
  unit coverage here is not a substitute; that effort mirrors Phase 2A's Task 9 (which had to build
  the `mongodb-memory-server` + `ioredis-mock` harness from scratch — it now exists and is reusable).
- Tenant-offboarding deletion certificate (PRD §14) — `portal-api`/tenant-lifecycle scope.
- Folder-level recycle bin / cascade delete, and group-delete cascade — deliberately rejected in
  favor of reject-when-in-use (Tasks 4 and 6).
- Cleaning up dangling grants/memberships when a **user** is deactivated — pre-existing gap in
  `TenantUsersAdminController`, noticed during this audit, unrelated to the routes built here.

## Self-Review Notes

- **Every authorization tier traces to a quoted ADR-0005 line**, not invention. This plan introduces
  no new authorization semantics — except the `hasExplicitGrants`-on-revoke rule in Task 5, which is
  an interpretation the ADR implies but never states outright, and is flagged as such.
- **Assumptions were verified, not deferred.** The first draft's three "check before assuming" flags
  were all resolved against the code before this revision; their answers are embedded above with
  file:line references so the implementer doesn't re-derive them.
- **Task 1 exists because of a real, reachable-by-this-plan outage path**, not defensive
  speculation — the exact throw/no-catch chain is cited so the implementer can confirm it in minutes
  rather than take it on faith.
- **Known remaining unknown:** whether fail-closed-per-folder (Task 1 Step 2) is the right call versus
  keeping the loud throw. Both sides are argued in the task; the implementer decides with the code in
  front of them and records the choice.
