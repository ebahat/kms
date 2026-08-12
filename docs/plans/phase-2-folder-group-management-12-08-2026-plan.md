# Phase 2 — Folder/Group Management API (backend) — 2026-08-12

**Status:** DRAFT, not yet executed.
**Scope:** the actual remaining backend gap in Phase 2 (`docs/plans/implementation-phases-11-07-2026-plan.md`),
found by audit on 2026-08-12: `FoldersController` and `GroupsController` do not exist anywhere in
`apps/api`, despite the full ADR-0005 permission-resolution library and `DocumentsPermissionsService`
already existing and working. This plan builds the management API surface those pieces were designed
to sit behind. **UI (2.6) and the permission-matrix/cross-tenant/signed-URL integration test suite
(2.7) are explicitly deferred to a follow-on plan** — this plan covers backend + unit tests only,
matching how Phase 2A sequenced its own backend-then-integration-tests-then-UI-spec split.

**Sources:** `docs/adr/0005-rbac-folder-permissions.md` (resolution algorithm, access tiers, grant
model, `permVersion` cache-invalidation contract, widening detection), `docs/adr/0006-file-storage-and-serving.md`
(storage key builder, deletion machinery this doesn't touch), `docs/requirements_v02.md` §7 (folder
CRUD, group management, PRD-level behavior), `docs/ui/screens_spec_v01.md` B2/C2/C3 (what the
eventual UI needs from this API — informs response shapes, not built here).

**Process note (lesson from Phase 2A's Task 11 final review):** that review found the Events/Tasks/
Calendar controllers had zero runtime request-body validation, unlike `AuthController`/`DocumentsController`'s
established zod pattern (`libs/contracts/src/*-dto.ts`, `SomeRequestSchema.parse(body)`). Every task
below uses that pattern from the start — new DTO files in `libs/contracts`, `.parse()` in the
controller, `BadRequestException` on failure — not retrofitted later.

## Task list overview

1. Contracts: zod schemas for folder/group requests (`libs/contracts`)
2. `FoldersController` — read routes (list/tree, detail, permission-scoped)
3. `FoldersController` — write routes (create, rename/move, delete)
4. `FoldersController` — grant management + `permVersion` wiring + effective-permission preview
5. `GroupsController` — CRUD + membership
6. Cross-tenant/non-member/module-boundary unit coverage + full workspace regression check
7. Final whole-branch review + finish

---

## Task 1: Contracts — folder/group request DTOs

**Files:**
- Create: `libs/contracts/src/folder-dto.ts`
- Create: `libs/contracts/src/group-dto.ts`
- Modify: `libs/contracts/src/index.ts` (export both)

**Interfaces produced** (mirror `libs/contracts/src/document-dto.ts`'s shape exactly — `z.object`,
`.parse()`-ready, one `z.infer` type export per schema):

```typescript
// folder-dto.ts
export const CreateFolderRequestSchema = z.object({
  parentId: z.string().nullable(), // null = root
  name: z.string().trim().min(1).max(255),
});

export const RenameFolderRequestSchema = z.object({ name: z.string().trim().min(1).max(255) });
export const MoveFolderRequestSchema = z.object({ parentId: z.string().nullable() });

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

Adjust exact field names/shapes if a later task discovers a real mismatch against `FoldersRepository`/
`GroupsRepository`'s actual method signatures (check `libs/data/src/repositories/folders.repository.ts`
and `groups.repository.ts` before finalizing — `createFolder` already exists there and takes
`{name, parentId}`, don't duplicate its cardinality/depth-bound logic in the DTO).

- [ ] Step 1: Write the schemas, export from `libs/contracts/src/index.ts`.
- [ ] Step 2: `pnpm --filter @kms/contracts build`; commit.

```bash
git add libs/contracts/src/folder-dto.ts libs/contracts/src/group-dto.ts libs/contracts/src/index.ts
git commit -m "feat: folder/group request DTOs (zod)"
```

---

## Task 2: `FoldersController` — read routes

**Files:**
- Create: `apps/api/src/folders/folders.controller.ts`
- Create: `apps/api/src/folders/folders.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts` (register controller — `FoldersRepository`/`GroupsRepository`/
  `PermissionCache` are already registered providers, per `documents-permissions.service.ts`'s own
  constructor — reuse `DocumentsPermissionsService`'s exact DI pattern for the permission cache token)

**Interfaces:**
- Consumes: `FoldersRepository.findAllForTenant`/`.findChildren`/`.findById` (all already exist,
  `libs/data/src/repositories/folders.repository.ts`), `libs/permissions`' `resolveFolderPermissionsCached`/
  `toFolderInputs`/`toPrincipalSet` (already exist, same import path `DocumentsPermissionsService` uses).
- Produces: `GET /folders?parentId=` (root when omitted — lazy tree browsing, not a full-tree dump,
  matching the ≤2000-folder cardinality bound's spirit even though a single response would technically
  fit), `GET /folders/:id`.

**Behavior (ADR-0005 §Consumption points + §Widening detection):**
- Every returned folder is filtered to the caller's `permittedRead` set — a folder outside it simply
  isn't in the list (never an error for the list route). `GET /folders/:id` on a folder outside
  `permittedRead` (or a nonexistent id) returns 404 — same convention as `DocumentsController`.
- Each returned folder includes: `id`, `name`, `parentId`, `hasExplicitGrants`, `isPublic`, the
  caller's own tier on it (`read`/`edit`/`manage`, derived from which permitted-set(s) it's in — NOT
  a raw grants dump for non-manage viewers), and `broaderThanParent`/`addedGroups` (ADR-0005's
  widening badge — resolve via the same tree-walk the resolver already does; check
  `libs/permissions/src/resolve-permissions.ts` for whether it already computes and returns this or
  whether this task needs to add it — the ADR describes it as part of "step 2-4" of the resolver, so
  it's plausible it's already computed and just not surfaced anywhere yet).
- `GET /folders/:id` for a caller with `manage` tier additionally includes the full `grants` array
  (principal-level detail — the C3 tenant-admin screen's data, not exposed to `read`/`edit` viewers
  per ADR-0005's "individually-granted users remain visible only in the tenant-admin C3 screen" rule).

- [ ] Step 1: Read `libs/permissions/src/resolve-permissions.ts` in full first — confirm the exact
  shape of `FolderPermissionResolution` and whether widening info is already attached or needs a
  second call. Don't guess the interface; the ADR text is a description, the actual exported types in
  `libs/permissions/src/types.ts` (`FolderWideningInfo`, `DecidingGrant`) are the contract.
- [ ] Step 2: Implement `list`/`detail`, TDD against the unit spec (mock `FoldersRepository`/`GroupsRepository`/
  `PermissionCache`, same style as `documents.controller.spec.ts`).
- [ ] Step 3: Register in `app.module.ts`; run `apps/api` unit suite; commit.

```bash
git add apps/api/src/folders/folders.controller.ts apps/api/src/folders/folders.controller.spec.ts apps/api/src/app.module.ts
git commit -m "feat: FoldersController read routes (list/detail, permission-scoped, widening badge)"
```

---

## Task 3: `FoldersController` — write routes (create/rename/move/delete)

**Files:**
- Modify: `apps/api/src/folders/folders.controller.ts` / `.spec.ts`

**Interfaces:**
- Produces: `POST /folders` (create), `PATCH /folders/:id` (rename), `PATCH /folders/:id/move` (move —
  separate route from rename since they need different tier checks, see below), `DELETE /folders/:id`.

**Authorization (ADR-0005 "Access tiers"):**
- **Create**: requires `edit` tier on the parent (`parentId: null` = root — creating a root folder
  requires tenant-admin, since no parent exists to hold an `edit` grant; use the same
  `scope.role === 'admin'` bypass `DocumentsPermissionsService` already uses for admins, and reject
  non-admins creating at root with a clear error, not a bare 404, since this isn't a hidden-resource
  case).
- **Rename**: requires `manage` on the folder itself ("manage... plus delete/move/rename").
- **Move**: requires `manage` on the folder AND `edit` (at least) on the destination parent — moving
  into a folder you can't add content to shouldn't be possible. Validate the move doesn't exceed
  `MAX_FOLDER_DEPTH` or create a cycle (moving a folder into its own descendant) — `FoldersRepository`
  doesn't currently have a move method; check before assuming `createFolder`'s depth-check logic is
  reusable as-is, it computes path from a fresh parent lookup, not a re-parent of an existing subtree
  (moving a folder with children means every descendant's `path` needs updating too — this is the
  trickiest part of this task, get it right before moving on, and write a dedicated test for
  "moving a folder with descendants updates every descendant's path").
- **Delete**: requires `manage`. **Design decision this task must make** (not resolved by any ADR —
  ADR-0006's deletion machinery is document-scoped, not folder-scoped): keep it simple for MVP —
  reject with a clear error if the folder has any children (subfolders) or any documents in it, rather
  than building a folder-level recycle-bin/cascade-delete system. Document this as a deliberate scope
  cut in the task report, not a silent gap.

- [ ] Step 1: Design + write the move-with-descendant-path-update logic; add a `FoldersRepository`
  method for it if the existing repository doesn't support it (check `folders.repository.ts` first —
  don't add a new method if `move`-shaped logic already exists under a different name).
- [ ] Step 2: TDD each route (create/rename/move/delete), including the depth/cycle/non-empty-delete
  rejection cases.
- [ ] Step 3: Full `apps/api` unit suite; commit.

```bash
git add apps/api/src/folders/folders.controller.ts apps/api/src/folders/folders.controller.spec.ts libs/data/src/repositories/folders.repository.ts
git commit -m "feat: FoldersController write routes (create/rename/move/delete)"
```

---

## Task 4: `FoldersController` — grant management + `permVersion` wiring + effective-permission preview

**Files:**
- Modify: `apps/api/src/folders/folders.controller.ts` / `.spec.ts`

**Interfaces:**
- Consumes: `PermissionCache.bumpVersion(tenantId)` (**already exists**,
  `libs/permissions/src/permission-cache.ts:51` — this is the task that finally calls it).
- Produces: `POST /folders/:id/grants` (add/update a grant), `DELETE /folders/:id/grants` (revoke,
  body-based per `RevokeFolderGrantRequestSchema` since DELETE-with-body is already how this codebase
  would need to identify principalType+principalId — check if there's a query-param convention used
  elsewhere in this codebase instead before defaulting to a body), `GET /folders/:id/effective-permission?userId=`.

**Behavior (ADR-0005 §Data Flow — "same operation" bump):**
- Grant add/revoke, requires `manage` on the folder. Update `folders.grants` (and `hasExplicitGrants`
  if this is the folder's first explicit grant — check the exact semantics against ADR-0005's step 2:
  a folder only inherits when `hasExplicitGrants` is false; adding a grant to a previously-inheriting
  folder must flip it to `true`, or the new grant would be silently ignored by the resolver) **and**
  call `bumpVersion(tenantId)` in the same request — ADR-0005 describes this as "same Mongo session";
  this codebase's repositories don't currently use Mongo transactions anywhere, so a strict
  same-transaction guarantee may not be achievable without new infrastructure. If a real transaction
  isn't feasible in the time this task has, do the grant write first, then the version bump,
  and record the ordering choice + the accepted-risk window in the task report (grant persisted but
  version-bump-failed is safe — a stale cache just means late propagation, not incorrect widening; the
  reverse ordering — version bumped before the grant write commits — is the one to avoid, since it
  would let a stale cache read serve *before* the actual data changes take effect). Also write the
  `auditEvents` entry ADR-0005's data-flow table calls for.
- `effective-permission` preview: `manage`-tier only (C3 admin screen), returns the target user's
  deciding grant per folder (reuses whatever `DecidingGrant`-shaped output the resolver already
  produces — check `types.ts`, don't invent a new shape).

- [ ] Step 1: Confirm `hasExplicitGrants` flip semantics by reading `resolve-permissions.ts`'s step-2
  handling directly, then TDD the grant-add/revoke routes including that flip case.
- [ ] Step 2: Wire `bumpVersion`; write a test asserting it's called exactly once per grant mutation,
  with the tenantId from scope (not from any request input).
- [ ] Step 3: `effective-permission` route; TDD.
- [ ] Step 4: Full `apps/api` unit suite; commit.

```bash
git add apps/api/src/folders/folders.controller.ts apps/api/src/folders/folders.controller.spec.ts
git commit -m "feat: folder grant management, permVersion cache invalidation, effective-permission preview"
```

---

## Task 5: `GroupsController` — CRUD + membership

**Files:**
- Create: `apps/api/src/groups/groups.controller.ts`
- Create: `apps/api/src/groups/groups.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `GroupsRepository` (`.findAllForTenant`, `.findById` via base `ScopedRepository`, `.findForMember`
  — all already exist). No `.create`/membership-update method currently exists on `GroupsRepository`
  beyond the inherited `ScopedRepository.create`/`.updateOne` — check whether those are sufficient
  as-is or whether a dedicated `addMembers`/`removeMembers` method is worth adding for atomicity
  (`$addToSet`/`$pull` on `memberUserIds`, avoiding a read-modify-write race under concurrent
  membership edits — `updateOne`'s raw `$set` on the whole array would lose concurrent edits).
- Produces: `POST /groups`, `GET /groups`, `GET /groups/:id`, `PATCH /groups/:id/members`,
  `DELETE /groups/:id`.

**Authorization:** create/membership-edit/delete are tenant-admin-only (`AdminOnlyGuard`, already
used by `DocumentsController`'s recycle-bin routes and `TenantUsersAdminController` — reuse it, don't
reinvent an admin check). `GET` (list/detail) is open to any authenticated tenant user — matches how
`GroupsMembershipService.isMember` already treats groups as visible-if-a-member-or-admin, but a plain
list/detail read doesn't need to be membership-gated the way events/tasks are, since group *names*
existing isn't the sensitive part (their folder grants and calendar/kanban contents are, and those
stay gated by their own controllers) — confirm this reasoning holds or gate reads too if it doesn't
sit right against PRD §7's stated model.

**Delete**: reject if the group has any folder grants, calendar events, or kanban tasks referencing
it (query `FoldersRepository`/`EventsRepository`/`TasksRepository` for any doc with this `groupId`/
grant) — same "reject rather than cascade" MVP posture as folder delete in Task 3. Document as a
deliberate scope cut, not silently assumed.

- [ ] Step 1: Decide + implement the membership-update method (atomic `$addToSet`/`$pull` vs. the base
  repository's methods) on `GroupsRepository`.
- [ ] Step 2: TDD all 5 routes, including the delete-rejection-when-in-use cases (one test per
  referencing entity type: has a folder grant, has an event, has a task).
- [ ] Step 3: Register in `app.module.ts`; full `apps/api` unit suite; commit.

```bash
git add apps/api/src/groups/groups.controller.ts apps/api/src/groups/groups.controller.spec.ts libs/data/src/repositories/groups.repository.ts apps/api/src/app.module.ts
git commit -m "feat: GroupsController CRUD + membership management"
```

---

## Task 6: Regression + non-member/cross-tenant unit coverage, full workspace check

**Files:**
- Modify: `apps/api/src/folders/folders.controller.spec.ts`, `apps/api/src/groups/groups.controller.spec.ts`
  (fill any gaps found in this pass, don't duplicate what Tasks 2-5 already covered)

- [ ] Step 1: Audit both new controllers' spec files against the same coverage bar Phase 2A's
  controllers hit: 404-not-403 on cross-tenant ids, 404 on a resource outside the caller's permitted
  set (not just "doesn't exist"), non-admin rejected from admin-only routes, malformed/invalid request
  bodies rejected with 400 (the Task-11 lesson — every new route needs at least one test proving the
  zod schema actually rejects a bad body, not just that the happy path validates).
- [ ] Step 2: `pnpm turbo run build lint test:unit` full workspace; fix anything red.
- [ ] Step 3: Commit any fixes found in Step 1/2 as their own commit (don't fold into Task 5's commit
  if Task 5 is already merged into the branch history by this point).

```bash
git add -A
git commit -m "test: regression + cross-tenant/admin/validation coverage for folder+group management"
```

---

## Task 7: Final whole-branch review + finish

Matches Phase 2A's own Task 11 precedent — run a full-branch code review (`/code-review main...<branch>`)
before merge, triage findings directly against the actual code (not blindly trusting a sub-agent
verdict — Phase 2A's own review run had reliability problems worth remembering), apply justified
fixes, re-verify with a full workspace check, then report merge-readiness.

- [ ] Step 1: Full-branch review.
- [ ] Step 2: Triage + fix findings.
- [ ] Step 3: Full `pnpm turbo run build lint test:unit` workspace check.
- [ ] Step 4: Update `docs/plans/implementation-phases-11-07-2026-plan.md`'s Phase 2 checklist
  (2.1b/2.2b → DONE) and this plan's own status header.
- [ ] Step 5: Report merge-readiness; merging itself is the user's call, same as Phase 2A.

---

## Explicitly out of scope for this plan (deferred to a follow-on plan)

- **2.6 UI**: folder tree/browser, upload progress, permission-management screens, group screens
  (UI spec B2/C2/C3). Needs this plan's API surface to exist first.
- **2.7 tests**: the permission-matrix integration suite (inheritance/override/public/widening),
  populating `test/cross-tenant/`'s still-empty harness, signed-URL expiry/tamper tests. This plan's
  Task 6 only adds unit-level coverage matching Phase 2A's own per-task discipline — the bigger,
  dedicated integration-test effort (mirroring Phase 2A's own Task 9, which had to build the
  `mongodb-memory-server`/`ioredis-mock` harness from scratch) is a separate plan.
- Tenant-offboarding deletion certificate (PRD §14) — `portal-api`/tenant-lifecycle scope, not this
  plan's folder/group management surface.
- Folder-level recycle bin / cascade delete for folders-in-use or groups-in-use — deliberately
  rejected rather than built (Tasks 3 and 5's delete routes).

## Self-Review Notes

- **Spec grounding:** every route's authorization tier traces to a specific ADR-0005 sentence (quoted
  inline per task) rather than invented — this plan does not introduce new authorization semantics.
- **Known unknowns flagged, not guessed:** the move-with-descendant-path-update mechanics (Task 3),
  the `hasExplicitGrants` flip-on-first-grant semantics (Task 4), and whether widening info is already
  computed by the resolver (Task 2) are all explicitly marked "read the actual code before assuming"
  rather than described as settled — matching the pattern that worked well in Phase 2A's own Task 8/9
  briefs.
- **Validation from the start:** every new route validates its request body via a `libs/contracts`
  zod schema (Task 1), directly addressing the gap Phase 2A's Task 11 review found in its own
  controllers, rather than repeating it here and fixing it later.
