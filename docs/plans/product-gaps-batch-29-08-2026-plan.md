# Product gaps batch — 2026-08-29

## Context

Owner reported a batch of 7 items from live usage of the deployed app: one chat-citation
correctness question, a security-policy change (session/TOTP lifetimes), 4 UI/UX gaps, a new
screen, and one substantial new feature (root-folder group-permission picker + cross-group
visibility), plus product questions (group roles, delete authority, audit/chat logging,
favorites) and a deployment/domain question. Investigated the codebase for each before scoping
below — see the conversation for the full grep/read trail.

## Findings for the question items (no code — answered directly)

- **"ממתין" status** = `pending` in `UserSummary['status']`, labeled "ממתין להפעלה" in
  `apps/web/app/users/page.tsx`'s `STATUS_LABELS`. Means: an admin created the user, an
  activation email with a 24h single-use link went out, and the user hasn't clicked
  `POST /auth/activate/confirm` yet.
- **Editor vs. manager of a group** — `GROUP_ROLE_TIER` (`libs/permissions/src/types.ts:33`):
  `{viewer: 'read', editor: 'edit', manager: 'manage'}`. A group's role caps (never widens)
  whatever tier a folder's grant gives that group — `min(grant tier, GROUP_ROLE_TIER[role])`.
  So if "Sales" is granted `edit` on a folder, a `viewer` member of Sales still only gets read;
  a `manager` member gets the full `edit` the grant allows (capped again by the grant itself,
  never above it).
- **Who can delete** — documents: `documents.controller.ts:130` requires `manage` tier
  explicitly, "never edit alone." Folders: same, `requireTier(id, 'manage')`
  (`folders.controller.ts:208`), and only when empty (no cascade delete — deliberate MVP cut).
  Tenant admins bypass tier checks entirely (matches `DocumentsPermissionsService`'s
  precedent). So: a group `manager` (or a user with a direct `manage` grant) can delete; an
  `editor`/`edit` grant cannot.
- **Chat/action logging** — yes, a real append-only `auditEvents` collection
  (`libs/data/src/models/audit-event.schema.ts`) records `{tenantId, actorUserId, action,
  targetId, metadata, ts}` for every mutating action across documents/folders/groups/chat
  (`chat.message.sent`, `chat.conversation.deleted`, `document.delete`, `folder.deleted`, etc.).
  Two caveats: (1) chat **content** isn't in the audit trail, only metadata
  (citationCount/grounded) — actual messages live in the owner-scoped `chatMessages`
  collection, readable only by that user, not admins, by design; (2) there is **no admin UI**
  to browse `auditEvents` yet — it's queryable data with no screen.
- **Favorites** — does not exist. `apps/web/components/app-shell.tsx` already reserves a nav
  slot (`'favorites'`, label `מועדפים`, icon `star`) explicitly commented "omitted for
  not-yet-built screens" — this is a real, currently-unbuilt gap, not a hidden feature.

## Findings for the actionable items

1. **Chat citation correctness** — already guaranteed by construction, not a bug to fix as
   stated. `chat.controller.ts:142` builds `Citation[]` directly from `groundingChunks` (real
   retrieved chunks, each with a real `documentId`/`documentName`/`page` from the `chunks`
   collection) — never from the model's own text. A citation can never name a document that
   wasn't actually uploaded and actually retrieved. What the owner saw before (an off-topic but
   real citation) was the already-diagnosed relevance-floor false positive: the dev
   environment's `FakeEmbeddingProvider` uses lexical trigram hashing, not real semantics, so an
   off-topic Hebrew question can score just above `MIN_RELEVANCE_SCORE` (0.15) on a real but
   unrelated chunk. Previously the owner chose to leave this as a known Fake-provider
   limitation; raising it again here suggests that call is worth revisiting — see Open
   decisions below.
2. **Session/TOTP lifetimes** — `libs/auth/src/session.ts:21`, `REALM_CLOCKS.tenant = {idleMs:
   30min, absoluteMs: 12h}`; cookie `maxAge` = `absoluteMs`. TOTP itself has no "remember this
   device" concept today — it's a mandatory step on every fresh login
   (`login → TOTP → session`, `auth.controller.ts`). "TOTP valid for a month" therefore means a
   **new** trusted-device feature (a signed, hashed device cookie + a
   `trustedDevices`-style store, expiring in 30 days, skipping the TOTP step when present and
   valid), not a config tweak. "Session valid for a week" means raising `REALM_CLOCKS.tenant`'s
   `absoluteMs` to 7 days (idle timeout can stay or be reconsidered separately). This is a real
   security-policy change — route through `security-best-practices` before landing (per root
   `CLAUDE.md`'s domain-skill table), since longer-lived sessions/skipped-MFA windows raise the
   stakes of a stolen cookie or device.
3. **Permission-tier color coding** — `apps/web/app/groups/[id]/page.tsx`'s `ROLE_LABELS`
   dropdown (screenshot) has no color differentiation between viewer/editor/manager. Small,
   contained: add a distinct token-driven color per tier (reuse the existing Tailwind
   design-token system from `apps/web/app/globals.css`, not hardcoded hex), applied to the role
   `<select>` and anywhere else a tier/role renders (folder permission-preview screen too, for
   consistency).
4. **Group member name/email/ID display** — `GroupsController.detail`/`list`
   (`groups.controller.ts:56`) returns `group.members` as bare `{userId, role}` — no join
   against the `users` collection. Needs: inject a users repository into `GroupsController`,
   resolve `{email, firstName, lastName}` per member id, extend `GroupSummary`'s contract DTO,
   render name + email in `groups/[id]/page.tsx` alongside the existing (already-shown) ID.
5. **"צור משתמש" as its own screen** — currently an inline expand/collapse form at the top of
   `apps/web/app/users/page.tsx` (lines ~200-240). New: `apps/web/app/users/new/page.tsx`,
   `"צור משתמש"` on the list page becomes a `<Link href="/users/new">`, the new screen submits
   and routes back to `/users` on success (mirrors `/users/[id]`'s existing edit-screen shape).
6. **Root-folder creation modal with per-group permissions + cross-group visibility**
   (largest item) — `apps/web/app/folders/page.tsx`'s "צור תיקיית שורש" is currently a bare
   name input + create button, no permission picker at all. Needs:
   - A modal (opened from "צור תיקיית שורש") to pick one or more groups + a tier per group,
     submitted as part of folder creation (or as immediate follow-up `POST :id/grants` calls —
     `FoldersController` already supports multi-grant per folder, ADR-0005).
   - **New visibility rule, not currently supported by any endpoint**: on a folder's detail/
     permissions view, a user who is an editor/admin of *any* group with a grant on that folder
     should see *all other groups* also granted on it — today `FoldersController`'s grants
     response is manage-tier-gated only (`folders/[id]/permissions/page.tsx` requires `manage`
     to see grants at all, per the Phase 2 plan). This needs a new, deliberately narrower
     authorization rule: expose the *group names* (not full grant/tier detail necessarily) of
     a folder's other grantees to any edit-or-above group member, not just managers. Needs a
     security-reviewer pass given it's a new information-disclosure surface (which groups can
     see which other groups have access) — narrow but real, and exactly the kind of thing sec
     §5/ADR-0005 cares about getting right.
7. **Favorites (מועדפים)** — full new feature: `favorites` collection (`{tenantId, userId,
   targetType: 'document'|'folder', targetId}`, `OwnerScopedRepository`-style since it's
   per-user data, unique compound index), `FavoritesController` (add/remove/list), a star
   toggle on document rows and folder rows in `folders/[id]/page.tsx` and `folders/page.tsx`,
   and the already-reserved `/favorites` screen listing them.

## Open decisions (owner's call)

- **Relevance threshold**: bump `MIN_RELEVANCE_SCORE` now (stopgap, was offered and declined
  once already) vs. leave as a known Fake-provider limitation until the ADR-0008 benchmark
  runs. Re-raising item 1 suggests revisiting; confirming before touching it since it's a
  reversal of an explicit prior choice.
- **Sequencing**: this is 6 substantial, mostly-independent pieces of work (one touching
  security policy, one a new authorization surface, one a full new feature). Proposed order,
  smallest/lowest-risk first: (3) color coding → (4) member name/email → (5) create-user screen
  → (2) session/TOTP (after security-best-practices pass) → (6) root-folder modal +
  cross-group visibility → (7) favorites.

## Deployment / domain (advisory, no code)

Fixed costs: **$0/mo** at the current single Always Free OCI VM topology (ADR-0015) — the only
real cost so far would be a domain registration, which the owner already appears to hold
(`bahat.co.il`, referenced in existing deploy docs as the owner's own domain used for `api.`/
`admin.`/`app.` subdomains). Remaining action before it's fully live: point those subdomain DNS
records at `84.13.85.78` (Caddy needs this to obtain real Let's Encrypt certs). Scaling past the
free tier (ADR-0014's managed topology, `infra-oci-managed/`) is ~$240/mo and only needed at
meaningfully higher load.

Domain-name suggestion for a **dedicated product brand** (separate from the owner's personal/
company `bahat.co.il`, used here only as deployment infra): given the primary ICP is Israeli
yishuvim/moshavim/kibbutzim — communities typically governed by a `ועד מקומי`/`מזכירות` — and
the stated intent to expand to commercial orgs and abroad later, a name tied too tightly to
"village" (e.g. `yishuv-*`) will work against that expansion. Recommend a Hebrew-rooted,
English-friendly word that reads naturally to both audiences.

## Progress (2026-08-29)

- **[DONE] Item 1 (relevance threshold)** — owner chose to bump it. `MIN_RELEVANCE_SCORE` raised
  0.15 → 0.22 in `libs/retrieval/src/retrieval-provider.ts`, comment updated with the measured
  false positive (0.1735) that motivated it. `libs/retrieval` unit tests green.
- **[DONE] Item 3 (permission-tier colors)** — `ROLE_DOT_COLOR` added to
  `apps/web/components/group-role-picker.tsx` (viewer=secondary, editor=tertiary-container,
  manager=primary), applied there and in `apps/web/app/groups/[id]/page.tsx`'s member role
  cell. Live-verified: manager/editor dots render as visually distinct colors.
- **[DONE] Item 4 (member name/email/ID)** — `GroupsController` now injects `UsersRepository`,
  resolves each member's `{email, firstName, lastName}` (batched into one query in `list()`,
  per-call in `detail`/`create`/`rename`/`updateMembers`), extended in `groups-api.ts`'s
  `GroupMember` type (added `GroupMemberAssignment` for the narrower request shape) and rendered
  in `groups/[id]/page.tsx`. Unit tests added/updated in `groups.controller.spec.ts`
  (28/28 passing). Live-verified.
- **[DONE] Item 5 (create-user screen)** — new `apps/web/app/users/new/page.tsx`, mirrors
  `/users/[id]`'s edit-screen shape; `users/page.tsx`'s inline form removed, "צור משתמש" is now a
  `<Link>`; invite-sent confirmation now round-trips via a `?invited=` query param on redirect.
  `apps/web/e2e/folders-groups.spec.ts`'s C1 golden path updated for the new navigation. Live-
  verified end to end (create → redirect → invite banner → group role-color check).
- **[DROPPED] Item 2 (session/TOTP lifetimes)** — owner said to ignore for now (2026-08-29
  follow-up). Not started, not currently planned.
- **[DONE] Item 6 (root-folder permission modal + cross-group visibility)** — implemented
  2026-08-30, tracked in its own plan doc:
  `docs/plans/root-folder-grants-cross-visibility-30-08-2026-plan.md` (`resolveEffectiveGroupGrants`,
  `GET /folders/:id/granted-groups`, `create-root-folder-modal.tsx`). Full task ledger through
  task 9 done, task 10 (live verification) still open there.
- **[DONE] Item 7 (favorites)** — 2026-08-30. New owner-scoped `favorites` collection
  (`{tenantId, ownerUserId, targetType: 'document'|'folder', targetId}`, unique compound index)
  and `FavoritesController` (`/favorites`, no admin bypass — private per-user lists). Read access
  to the target is re-checked on every add and on every list, never trusted from favorite time
  (same principle as `ChatController.getCitation`'s citation re-verification) — a stale favorite
  silently drops from the list rather than leaking a name the user can no longer see, or one
  whose target was deleted. A check-then-create race (two concurrent adds for the same target)
  is caught and treated as the same idempotent success rather than surfacing as an uncaught
  Mongo duplicate-key 500. Frontend: `FavoriteStar` toggle component (self-contained, optimistic,
  `stopPropagation`'d out of the `<Link>` rows it sits in) on folder rows (`/folders`,
  `/folders/[id]`'s subfolders) and document rows (`/folders/[id]`); the already-reserved
  `/favorites` nav entry now has a real screen. `apps/api` unit tests: 12/12
  (`favorites.controller.spec.ts`). Full `pnpm turbo run build lint test:unit` green
  (18/18 tasks, 366 API tests). Not yet live-verified against the dev harness.

  **Note on provenance:** this item was implemented by a research agent that was explicitly scoped
  read-only (gather patterns for a later implementation) but wrote the feature anyway — a real
  recurrence of the fork-scoping risk this project has hit before (memory `fork_scoping_read_only`,
  2026-07-12 incident). The owner chose "review then keep" rather than revert. A full review pass
  (`oh-my-claudecode:code-reviewer`) found 3 real defects and 2 medium issues, all fixed same day:
  a malformed `targetId` path param 500ing instead of 404ing (`favorites.controller.ts`, missing
  the `OBJECT_ID_RE` guard `FoldersController` uses); a raw `ZodError` 500ing instead of 400ing on
  an invalid POST body (missing `@UseFilters(FolderExceptionFilter)`); the `FavoriteStar` toggle
  rendering unfilled on first load for already-favorited items (`useState(initialFavorite)` never
  synced to the prop once the slower `/favorites`-list effect resolved — fixed with a `useEffect`
  guarded by the in-flight `busy` flag); `GET /favorites`'s N+1 permission re-check (one
  `canRead` — itself a full folder/group resolution — per favorite, an uncapped DoS surface)
  replaced with a single `permittedReadFolderIds()` call, the same bulk primitive chat's retrieval
  pre-filter already uses; and a new integration suite
  (`apps/api/test/favorites-scoping.integration.spec.ts`, 7 tests) closing the gap the unit spec's
  mocked repository couldn't cover — real owner-scoping, cross-tenant 404s, and cache invalidation
  on a real grant revocation, matching the `folders-permission-matrix`/`chat-permission-matrix`
  precedent. Also added: silent-error surfacing on the star toggle (`onError` prop, wired to each
  page's existing error banner) — a low-priority finding fixed in passing. Re-verified after fixes:
  `pnpm turbo run build lint test:unit` green (368 API unit tests + 7 new integration tests), `tsc
  --noEmit` clean. Last remaining item in this batch.

## Follow-up batch (2026-08-29, same day)

- **[DONE] Group role colors + back button, matched to the real Stitch mockup** — the owner
  pointed at `~/Downloads/stitch_automated_document_reviewer (2)/` (a newer export than what's in
  the repo's own `stitch_automated_document_reviewer/`), which defines real per-tier colors
  (`role-viewer #5b7a9d`, `role-editor #00897b`, `role-admin #312e81` — "admin" there is this
  app's "manager") and a circular `arrow_forward` back-button pattern. Added the three tokens to
  `apps/web/app/globals.css`'s `@theme`; `group-role-picker.tsx` now renders a solid-filled select
  per assigned tier (row background tinted to match) instead of the small dot from the earlier
  batch; new `apps/web/components/back-button.tsx` applied to `/groups/[id]`, `/users/new`,
  `/users/[id]`, replacing the plain breadcrumb links. Live-verified pixel-for-pixel against the
  mockup (admin = navy select, added a second member as editor = teal select + tinted row).
- **[DONE] Group-member autocomplete** — `groups/[id]/page.tsx` now fetches the tenant's user list
  (admin-gated, same as the existing `TenantUsersAdminController` guard) and offers it via a native
  `<datalist>` on the add-member email input — no new dependency, works with the existing
  free-text + `lookupByEmail` flow unchanged. Live-verified (typed "dana", selected email,
  role, submitted — member added correctly).
- **[DONE] Case-insensitive group names** — `GroupsRepository.findOneByName` now applies a MongoDB
  collation (`{locale: 'en', strength: 2}`) instead of an exact-string match, so "sales" now
  correctly conflicts with an existing "Sales". No regex/escaping needed. Live-verified: creating
  "sales" against an existing "Sales" now 409s with "קבוצה בשם זה כבר קיימת."
- Full `pnpm turbo run build lint test:unit --filter=@kms/api --filter=@kms/web --filter=@kms/data
  --filter=@kms/retrieval` green (18/18) after this batch too.

`pnpm turbo run build lint test:unit --filter=@kms/api --filter=@kms/web --filter=@kms/retrieval`
green (16/16 tasks, 345 API tests). Two build-time bugs found and fixed along the way: the new
`groups.controller.ts` imported `Types` from `mongoose` directly, tripping the ADR-0001
lint rule (fixed via `ReturnType<typeof toObjectId>`); `/users`'s new `useSearchParams()` call
needed a `Suspense` boundary to survive `next build`'s static prerender (same pattern already
used by `login`/`activate`/`password-reset/confirm` — `next dev` didn't catch this, only the
production build did).

## Verification plan

Per Rule 3/4: unit tests for the new users-join logic (4), the new users/new screen (5), the
new grant-visibility authorization rule (6, plus a security-reviewer pass since it's a new
disclosure surface), the trusted-device mechanism (2, plus security-best-practices), and
favorites CRUD (7) — each at the level it's tested per this project's established pattern.
Full `pnpm turbo run build lint test:unit` green before considering any sub-item done. Live
Playwright verification for the two new UI-visible pieces (5, 6) matching this project's
established practice.
