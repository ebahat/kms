# Root-folder permission modal + cross-group visibility (Item 6)

## Context

From the 2026-08-29 product-gaps batch (`docs/plans/product-gaps-batch-29-08-2026-plan.md`, item 6/7e),
the owner's request, verbatim:

> The button "צור תיקיית שורש" should open a modal to pick the groups permissions for that directory.
> A directory can have permissions for several groups. The groups names that can access a certain root
> directory should be visible to editors and admins of these groups. E.g. if I am a user of the
> "מנהלים" group, and this group and also the "צוות מטה" group have a permission for the "פרוטוקולים"
> directory, then when I view the root directory of "פרוטוקולים" then I will be able to see that also
> "צוות מטה" have permission to that directory, so I will not accidentally publish there confidential
> material.

Two distinct pieces:
1. **Creation-time group picker** — today, root-folder creation (`apps/web/app/folders/page.tsx`'s
   `onCreate`) is a bare name input calling `foldersApi.create({parentId: null, name})` — no group
   selection exists at all. `FoldersController.create()`'s root branch (`folders.controller.ts:144-151`)
   creates with `grants: []` always (`FoldersRepository.createFolder`, `folders.repository.ts:40`).
2. **Cross-group visibility** — no code path today lets anyone see "which other groups can also see
   this folder." The only existing "who can see this" mechanism is `GET /:id/effective-permission`
   (`folders.controller.ts:295-316`), which is **manage-tier gated** and answers "what tier does *one
   named user* get", not "which groups have a grant at all." The owner's ask is for a **lower bar**
   (edit-tier, i.e. "editors and admins" of a granted group) to see the **group list**, not individual
   users.

## Design

### Backend

1. **`libs/permissions/src/resolve-permissions.ts`** — new exported function:
   ```ts
   export function resolveEffectiveGroupGrants(folders: FolderInput[], folderId: string): FolderGrantInput[]
   ```
   Reuses the existing (already-correct, unexported) `computeEffectiveBundles` — looks up the target
   folder's effective bundle (inheritance already resolved) and returns just the `principalType ===
   'group'` grants from it. Returns `[]` for an unknown folder id (fail-closed, matches
   `computeEffectiveBundles`'s own orphan handling). No new inheritance logic — this is a thin read over
   logic that already exists and is already tested.

2. **`libs/contracts/src/folder-dto.ts`** — extend `CreateFolderRequestSchema` with an optional
   `grants` array, restricted to `principalType: 'group'` (no per-user grants at creation time — that
   capability already exists post-creation via the existing `/grants` endpoint and isn't part of this
   ask):
   ```ts
   grants: z.array(z.object({ principalType: z.literal('group'), principalId: objectIdString, access: z.enum(['read','edit','manage']) })).optional()
   ```

3. **`apps/api/src/folders/folders.controller.ts`**:
   - `create()`'s root branch: after `createFolder`, loop `this.folders.upsertGrant(...)` for each
     provided grant (sequential, no transactions — matches this codebase's established best-effort
     write pattern, see `bumpVersionAndAudit`'s own doc comment), then a single `bumpVersionAndAudit`
     call (not one per grant) with the grants included in the audit metadata. The non-root branch is
     untouched — `grants` is only meaningful/wired for `parentId === null`, matching the literal scope
     of the ask (the create-subfolder UI keeps its current bare-name form).
   - New endpoint: `GET /:id/granted-groups`, gated at **edit tier** via the existing `requireTier(id,
     'edit')` (not `manage`) — this is the "editors and admins of these groups" bar from the request,
     and is deliberately lower than the existing manage-gated raw-grants array in `detail()`. Returns
     only `{groupId, groupName, access}[]` — group principals only (no user-type grants, no other
     folder metadata), keeping the new disclosure surface as narrow as what was actually asked for.

### Frontend

4. **`apps/web/lib/folders-api.ts`** — `create()`'s input type gains optional
   `grants?: {principalType: 'group'; principalId: string; access: 'read'|'edit'|'manage'}[]`; new
   `grantedGroups(id)` API function.
5. **New `apps/web/components/create-root-folder-modal.tsx`** — modal matching `FolderPicker`'s
   existing visual/structural pattern (`fixed inset-0` overlay, header/body/footer sections, Cancel +
   primary action). Body: folder-name input + a checkbox-per-tenant-group list (from
   `groupsApi.list()`), each checked group getting an access-tier `<select>` (read/edit/manage,
   defaulting to read). Submits via `foldersApi.create({parentId: null, name, grants})`.
6. **`apps/web/app/folders/page.tsx`** — replace the inline name-input+button with a single "צור
   תיקיית שורש" button (matches the owner's own wording) that opens the new modal. Still admin-gated,
   unchanged from today.
7. **`apps/web/app/folders/[id]/page.tsx`** — new "groups with access to this folder" panel, gated on
   `canEdit` (not `canManage` — the existing var already computed at line 252), fetching
   `foldersApi.grantedGroups(folderId)` and rendering group-name + tier badges. Uses the effective
   (inheritance-resolved) list, so it's correct on both explicit-grant and inheriting folders alike.

### Security

The new `granted-groups` endpoint is a genuinely new, narrow information-disclosure surface (group
names visible below `manage` tier, where they previously were not visible to non-admins at all except
indirectly via the tenant-admin-only `/groups` list). Per Rule 4, run a `security-reviewer` pass after
implementation specifically on this endpoint + the modal's data flow, not the whole diff.

## Explicit scope cuts

- No per-user grants in the creation modal (group-only, as scoped above).
- Sub-folder creation UI is untouched — group picker only applies to root-folder creation, matching
  the literal request.
- No change to the existing manage-tier permissions screen (`/folders/[id]/permissions`) — it keeps
  its own separate, broader (`effective-permission`, raw grants) capabilities untouched.

## Task ledger

1. `[DONE]` `resolveEffectiveGroupGrants` in `libs/permissions` + unit tests (5 new tests: own grants,
   excludes user-type, inheritance, empty, unknown-folder fail-closed) — 36/36 permissions tests pass.
2. `[DONE]` `CreateFolderRequestSchema` grants field in `libs/contracts` (`principalType: z.literal('group')`
   only — per-user grants at creation time stay out of scope).
3. `[DONE]` `FoldersController.create()` grants wiring + `GET /:id/granted-groups` + unit tests — 6 new
   `create` tests (batched grants, no-grants default, non-group rejection) + 6 new `grantedGroups` tests
   (edit-tier bar, user-grant exclusion, inheritance, admin bypass, 404s). 59/59 folders controller tests pass.
4. `[DONE]` `folders-api.ts` client changes (`FolderGroupGrant`/`GrantedGroup` types, `create()`'s optional
   `grants`, new `grantedGroups()`).
5. `[DONE]` `create-root-folder-modal.tsx` — group-picker modal matching `FolderPicker`'s shape.
6. `[DONE]` `/folders/page.tsx` wiring — inline form replaced by the modal, button renamed to the
   owner's own wording ("צור תיקיית שורש").
7. `[DONE]` `/folders/[id]/page.tsx` visibility panel — gated on `canEdit` (edit tier and above, not
   just manage), shows group name + tier for every group with effective access to the folder.
8. `[DONE]` `pnpm turbo run build lint test:unit` green across all 10 workspace packages (39/39 tasks).
9. `[DONE]` Rule 4 pipeline: a `security-reviewer` subagent pass was attempted but its findings never
   surfaced through the completion-notification path in this environment (a reproducible tool issue,
   reported separately) even after a resume — so the security/code review was done directly instead.
   Verified: tenant isolation holds (both `FoldersRepository`/`GroupsRepository` are `ScopedRepository`,
   so `grantedGroups` can never cross a tenant boundary, and `findForMember`'s tenant scoping means a
   creation-time grant naming a foreign-tenant group id is inert — it can never enter any real user's
   principal set); the `scope.role !== 'admin'` gate on root-folder creation runs before any grant is
   ever applied, so the new `grants` field cannot be reached by a non-admin; the Zod schema strips
   unknown keys by default (no mass-assignment risk). One real issue found and fixed: `/folders/[id]`'s
   `grantedGroups` state wasn't cleared at the top of `load()`, so navigating between folders could
   briefly show the PREVIOUS folder's group list as if it applied to the new one — fixed by resetting
   it synchronously before the fetch, since this panel's whole purpose is accurate disclosure of who
   can see what. Re-ran `pnpm turbo run build lint test:unit` after the fix — still 39/39 green.
10. `[ ]` Live verification (dev harness): create root folder with 2 groups picked → confirm both
    members see each other's group name on the folder page, a plain viewer of one group does not, an
    unrelated user gets 404.
