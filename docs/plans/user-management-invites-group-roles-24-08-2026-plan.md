# User management: identity, email invitations, and per-group roles

Status: PLANNED — not started. Written 2026-08-24. **No code changes have been made.**

Covers four requirements from `docs/adr/Users_management.md` plus the owner's clarifications
(2026-08-23/24). Supersedes that ADR file wherever the two disagree — see "Deviations from the ADR"
at the end.

## Origin

Owner requirements, verbatim:

1. **No single "username" field. It has to be firstName + lastName.**
2. **Email uniqueness has to be enforced whenever creating a new user or updating their email.**
3. **There should be an option to add a group with permissions when creating/updating a user.**
4. **Whenever adding a user, the system sends an email with a URL. Clicking it opens a screen asking
   them to create a password and connect with it. The invitation link expires after 24 hours.**
5. **Per-group role:** "Whenever adding a user to a group I would like to define explicitly if the
   user is a viewer or editor... This also changes the control of creating a user and editing their
   details, as the read-only/edit permissions have to be per-group." Refined 2026-08-24 to three
   roles: **viewer, editor, manager**.

### Decisions settled before planning (2026-08-23/24)

| # | Question | Decision |
|---|---|---|
| 1 | Password floor: 8 (as requested) or 12 (existing system-wide floor)? | **12** — keep one policy. `libs/contracts/src/auth-dto.ts:24` already enforces `min(12)` for reset; activation must not be weaker. |
| 2 | Reuse `passwordResetTokenHash` for invites, or separate fields? | **Separate** — an admin invite and a user-initiated reset must never collide on the same fields. |
| 3 | What does "reactivate" mean for a user who never activated? | → **`pending`** + a fresh invite email, not `active`. Requires a new `activatedAt` marker to tell the two cases apart. |
| 4 | Is "resend invite" in scope? | **Yes, required.** |
| 5 | Can group membership reach the `manage` tier? | **Yes** — three roles (viewer/editor/manager) mapping 1:1 onto the existing `read`/`edit`/`manage` tiers. |
| 6 | How do existing groups/members migrate? | **Delete and start over.** No real customer data exists yet. |
| 7 | Does CSV import need group+role columns? | **Yes.** |

### Still open (deliberately deferred, not blocking)

- **Calendar/kanban authorization is left role-agnostic.** `GroupsMembershipService.isMember()`
  (`apps/api/src/groups/groups-membership.service.ts:21`) gates events/tasks on bare membership per
  the Phase 2A design decision. The owner framed viewer/editor in terms of *documents and
  directories*; calendar/kanban is v1.1 scope with no UI built. This plan renames the field it reads
  but does **not** change its semantics — a viewer-role member keeps today's full events/tasks
  access. Revisit when the v1.1 calendar/kanban UI is built.
- **Email-change re-verification.** Changing a user's email is admin-initiated here; we do not send
  a confirm-your-new-address challenge. Acceptable for an admin-managed internal directory; revisit
  if self-service email change is ever added.

## What exists today (verified, not assumed)

- `User` (`libs/data/src/models/user.schema.ts`): already has optional `firstName`/`lastName`
  (:29-33, added 2026-08-22), a **globally unique** `email` (:19), `status: 'active'|'inactive'|
  'locked'` (:42), and `passwordResetTokenHash`/`passwordResetExpiresAt` (:66-70).
- `Group` (`libs/data/src/models/group.schema.ts`): `memberUserIds: Types.ObjectId[]` (:15) — flat,
  **no role**. Unique `{tenantId, name}` index (:23, added 2026-08-23).
- `TenantUsersAdminController` (`apps/api/src/tenant-admin/tenant-users-admin.controller.ts`):
  `list`/`create`/`deactivate`/`reactivate`/`importCsv`. **No update endpoint.** `create()` returns a
  one-time `tempPassword` in the response body (:50) — no email is sent.
- Access tiers (`libs/permissions/src/types.ts:7-18`): `AccessTier = 'read'|'edit'|'manage'`, with
  `tierRank()`/`tierAtLeast()`. A folder grant names a principal (`user` or `group`) and a tier.
- `resolveFolderPermissions()` (`libs/permissions/src/resolve-permissions.ts:89`): a user's tier on
  a folder is the **max** over every matching grant. Group membership carries no cap today — every
  member gets the group's full granted tier.
- `FoldersController` gates every grant/revoke/rename/delete through `requireTier(id, 'manage')`,
  which reads `resolution.permittedManage` — i.e. **straight off the resolver's output**. This is
  why the resolver change below needs no controller changes to take effect.
- `NotificationProvider` (`apps/api/src/notifications/notification-provider.ts`): `sendEmail({to,
  subject, body})`, with real (`resend-`) and `fake-` adapters already wired. `AuthController.
  requestPasswordReset()` (:226-237) is a working template for token → link → email.
- `createResetToken()` / `isResetTokenValid()` (`libs/auth/src/password-reset.ts`): SHA-256-hashed
  128-bit single-use tokens, 30-minute TTL. `isResetTokenValid` is already generic over hash+expiry.

---

# Design

## A. Identity and editing

`firstName`/`lastName` already exist and are already required at the API boundary
(`CreateUserRequestSchema`). **Requirement 1 needs no work.**

Requirement 2 needs a new endpoint — there is no way to edit a user today at all.

### `PATCH /tenant-admin/users/:id`

Body (all optional, at least one required): `firstName`, `lastName`, `email`, `role`,
`groups: [{groupId, role}]`.

- **Email uniqueness**: lowercase+trim, then rely on the existing global unique index; catch E11000 →
  `409 {error: 'EMAIL_ALREADY_EXISTS'}`. Same treatment as `create()`. A no-op change (same email)
  must not 409 — compare case-normalized before writing.
- **Email change on a `pending` user re-issues the invite.** The activation link embeds
  `?email=…` (mirroring `password-reset/confirm`), so the old link would be dead anyway. Invalidate
  the old token and send a fresh invite to the new address.
- **Role change revokes sessions.** `SessionRecord` carries `role`, and CLS scope is populated from
  it — a demoted admin would otherwise keep admin rights until their session expired. Call
  `sessions.revokeAll('tenant', userId)` on any role change, matching what `deactivate()` already
  does. Fail-closed, and cheap.
- **Group membership diffing** happens here (see C).

## B. Email invitations and activation

Replaces the "show a temp password once" flow entirely.

### Schema (`User`)

```ts
@Prop({ required: true, enum: ['pending', 'active', 'inactive', 'locked'], default: 'active' })
status!: 'pending' | 'active' | 'inactive' | 'locked';

/** SHA-256 hash of the 128-bit single-use invite token, 24h TTL. Separate from the
 *  password-reset pair so an admin invite and a self-service reset never collide. */
@Prop() inviteTokenHash?: string;
@Prop() inviteExpiresAt?: Date;

/** Set once, the first time activation actually completes. Distinguishes "deactivated after
 *  really using the system" from "deactivated while the invite was still outstanding" —
 *  which is what reactivate() branches on. */
@Prop() activatedAt?: Date;
```

### Token helper (`libs/auth/src/invite.ts`, new)

`password-reset.ts`'s TTL is hardcoded at module scope, so extract the shared parts rather than
copy them:

- Add `createToken(ttlMs)` and rename-with-alias `isTokenValid` (keep `isResetTokenValid` as a
  re-export so no existing call site changes).
- `createInviteToken()` = `createToken(24 * 60 * 60_000)`.
- `isInviteTokenValid` = the same generic validator.

### Flow

1. **Create** (`POST /tenant-admin/users`): generate an unguessable random `passwordHash` that is
   never shown to anyone (so the account cannot be logged into before activation), set
   `status: 'pending'`, mint a 24h invite token, send the email. Response becomes
   `{userId, email, status: 'pending'}` — **no `tempPassword`**.
2. **Email**: link is `${APP_PUBLIC_URL}/activate?email=…&token=<raw>`. Raw token appears **only** in
   the email body — never logged, never in a response (sec §2, same discipline as reset).
3. **`POST /auth/activate/confirm`** (`@Public()`): `{email, token, newPassword}`.
   - Validate the invite token → else `401 {error: 'INVALID_OR_EXPIRED_TOKEN'}`.
   - `newPassword` ≥ **12** chars (decision 1) + `isPasswordBreached()` check → `400
     {error: 'PASSWORD_BREACHED'}`. Both reuse `confirmPasswordReset`'s existing logic.
   - Set `passwordHash`, `status: 'active'`, `activatedAt: new Date()`, `$unset` the invite pair.
4. **`GET /auth/activate/check?email&token`** (`@Public()`): returns `{valid: boolean}` so the UI can
   show "this link expired" *before* the user types a password. Returns only a boolean — no user
   data, no enumeration surface beyond what the token already implies.
5. **`POST /tenant-admin/users/:id/resend-invite`** (admin): only valid when `status === 'pending'`
   (else `409`). Mints a fresh token — which invalidates the previous one — and re-sends.

### Fail-closed audit of the new `'pending'` status

Adding an enum value silently changes every existing `status` check. Each of these must be visited:

- **Login must reject `pending`** with the same generic failure as bad credentials (no enumeration).
- **`password-reset/request`** currently gates on `user.status !== 'inactive'`
  (`auth.controller.ts:225`) — a `pending` user would be handed a *reset* link and could set a
  password without ever consuming the invite, bypassing activation. Tighten to
  `status === 'active'`.
- **`deactivate()`** must also `$unset` the invite token, so deactivating someone kills any
  outstanding invitation link immediately rather than leaving a live 24h window.
- **`reactivate()`** branches (decision 3):
  ```
  if (user.activatedAt)  → status = 'active'                    // unchanged behavior
  else                   → status = 'pending' + fresh invite + email
  ```
  The `else` branch is the same code path as resend-invite; factor it into one private helper.
- **`list()`/`toSummary()`** pass `status` straight through — the UI gains a `pending` badge.

## C. Per-group roles (viewer / editor / manager)

### The model

A group's grant on a folder sets the **ceiling**; a member's role within the group **narrows** it.
Effective tier = `min(grant tier, role cap)`. The three roles map 1:1 onto the tiers that already
exist:

| Role | Caps at | Can |
|---|---|---|
| `viewer` (צופה) | `read` | View documents and folders |
| `editor` (עורך) | `edit` | Add / edit / delete documents and folders |
| `manager` (מנהל) | `manage` | Everything an editor can, plus grant/revoke access to that folder |

Because the cap is a `min()`, a role can only ever *narrow*, never widen: a `manager` in a group
granted only `read` still gets `read`. Direct per-user folder grants are **unaffected** — they name
the user, not a group, so no cap applies.

### Schema (`Group`)

```ts
@Prop({ required: true, type: [{ userId: Types.ObjectId, role: String }], default: [] })
members!: { userId: Types.ObjectId; role: GroupMemberRole }[];
```

Index: `GroupSchema.index({ tenantId: 1, 'members.userId': 1 })` — replaces the reliance on the bare
`{tenantId: 1}` index for `findForMember()`.

### ⚠ Repository concurrency trap

`addMembers()` today uses `$addToSet` with an explicit comment that a read-modify-write `$set` "must
not clobber concurrent membership edits" (`groups.repository.ts:37-39`). **`$addToSet` breaks the
moment members are objects**: `{userId: X, role: 'viewer'}` and `{userId: X, role: 'editor'}` are
distinct values, so a role change would *append a second membership row* for the same user rather
than update the existing one — leaving the resolver to pick whichever it saw first.

Replace with an explicit two-step per member, preserving the no-clobber property:

```ts
async setMember(id, userId, role) {
  await this.updateOne({ _id: id }, { $pull: { members: { userId } } });
  await this.updateOne({ _id: id }, { $push: { members: { userId, role } } });
}
```

Idempotent, safe to re-run, and correct for both "add" and "change role". `removeMembers()` becomes
`$pull: { members: { userId: { $in: userIds } } }`. `findForMember()` becomes
`this.find({ 'members.userId': userId })`.

### Resolver changes (`libs/permissions`)

`types.ts`:

```ts
export type GroupMemberRole = 'viewer' | 'editor' | 'manager';

/** The one place the membership vocabulary meets the folder-grant vocabulary. */
export const GROUP_ROLE_TIER: Record<GroupMemberRole, AccessTier> =
  { viewer: 'read', editor: 'edit', manager: 'manage' };

export interface PrincipalSet {
  userId: string;
  groups: { groupId: string; role: GroupMemberRole }[];  // was: groupIds: string[]
}

export type DecidingGrant =
  | { tier: AccessTier; via: 'public' }
  | { tier: AccessTier; via: { principalType: PrincipalType; principalId: string };
      /** Set when the group's grant was higher than this member's role allowed — drives the
       *  C3 "why can Dana see this?" explanation. */
      cappedBy?: GroupMemberRole };
```

`resolve-permissions.ts` — `principalKeys: Set<string>` becomes `principalCaps: Map<string,
AccessTier>` (the user's own key maps to `'manage'`, i.e. uncapped; each group key maps to
`GROUP_ROLE_TIER[role]`), and the grant loop applies the cap:

```ts
const cap = principalCaps.get(grantKey(grant.principalType, grant.principalId));
if (!cap) continue;
const effective = tierRank(grant.access) <= tierRank(cap) ? grant.access : cap;
if (!best || tierRank(effective) > tierRank(best.tier)) {
  best = { tier: effective, via: {...}, cappedBy: effective !== grant.access ? role : undefined };
}
```

The union-across-principals rule is unchanged — it just maxes over *capped* tiers now.

**`computeFolderWidening()` needs no change.** It compares read-*audiences* (who can see this at
all), which is viewer-independent; a role cap never removes someone from the audience, since even
`viewer` implies `read`.

`adapters.ts` — `toPrincipalSet()` must now pull *this user's* role out of each group:

```ts
export function toPrincipalSet(userId: string, memberGroups: GroupDocument[]): PrincipalSet {
  return {
    userId,
    groups: memberGroups.flatMap((g) => {
      const m = g.members.find((m) => m.userId.toString() === userId);
      return m ? [{ groupId: g._id.toString(), role: m.role }] : [];
    }),
  };
}
```

### Why no controller changes are needed for enforcement

`FoldersController.requireTier()` reads `resolution.permittedEdit` / `permittedManage` — both
produced by the resolver. Once the cap lands, a viewer-role member is automatically excluded from
`permittedEdit` and therefore automatically 403s on every mutation, and a manager-role member
automatically gains grant/revoke. **All enforcement flows through the one pure function**, which is
also why the integration test below is the highest-value test in this plan.

### `permVersion` invalidation

`GroupsController.updateMembers()` already bumps `permVersion` + audits on add/remove
(`groups.controller.ts:122`). A **role change** must bump too — it changes effective permissions
exactly as much as an add/remove does. Same code path, just make sure role-only edits route through
it rather than short-circuiting.

## D. CSV import with groups

Columns: `email, firstName, lastName, role, groups`.

- `groups` format: `Sales:editor;Legal:viewer` — semicolon-separated `name:role` pairs.
- **Referenced by group *name*, not ObjectId** — a CSV author will not have ids. This is only
  unambiguous because `{tenantId, name}` is unique (added 2026-08-23); note the dependency.
- Unknown group name → **row error, user not created**. Invalid role → row error. Groups are never
  auto-created (a typo would otherwise silently create "Legl").
- Empty/absent `groups` cell → no memberships, not an error.
- Each imported row sends its own invite email; no temp passwords anywhere.
- Existing per-row error reporting (row number + reason, partial success) is unchanged.

## E. UI changes

| Screen | Change |
|---|---|
| `/users` (table) | New `pending` status badge (**ממתין להפעלה**). New per-row **שלח הזמנה מחדש** action, shown only for `pending`. New **ערוך** (pencil) action → `/users/[id]`. Remove the one-time temp-password banner. |
| `/users` (create form) | Add the group+role picker (below). Success message becomes "נשלחה הזמנה בדוא\"ל" instead of showing a password. |
| `/users/[id]` **(new)** | Edit firstName / lastName / email / role + group memberships. Email-conflict error surfaces inline via the existing `apiErrorMessage()` path. |
| `/groups/[id]` | Member list gains a per-member role selector (viewer/editor/manager), replacing the current add/remove-only list. |
| `/activate` **(new)** | Public. Reads `?email&token`, calls `activate/check` first to show an "expired link" state instead of a dead form, else collects the new password (≥12, confirm field) and posts to `activate/confirm`, then redirects to `/login`. Mirrors the existing `/password-reset/confirm` screen. |

**Group+role picker** (shared component, used by both the create form and the edit screen): a list of
the tenant's groups, each with a role selector that is unset by default (= not a member). The ADR's
"toggle grid with indeterminate state" is a heavier design; a list with an inline 3-way selector
carries the same information with far less UI surface. Recommend the simpler version for v1 and
revisit only if the group count makes it unwieldy.

Bulk "assign selected users to groups" from the table, table search/filter/pagination, and the
XLSX import path from the ADR are **not** in this plan — see Deviations.

---

# Test plan

Per Rule 3, tests are written alongside each task, not after. Random ids/emails throughout.

### Unit — `libs/permissions`

`resolve-permissions.spec.ts` (the security core; every row below is a distinct test):
- group granted `manage`, member is `viewer` → effective `read`
- group granted `manage`, member is `editor` → effective `edit`
- group granted `manage`, member is `manager` → effective `manage`
- group granted `read`, member is `manager` → effective `read` (**a cap never widens**)
- two groups, `read`+`viewer` and `edit`+`editor` → effective `edit` (union takes the max of capped)
- direct per-user grant of `manage` + viewer membership elsewhere → `manage` (direct grants uncapped)
- `decidingGrant.cappedBy` is set when capped, absent when not
- `computeFolderWidening()` output is unchanged by member roles (regression guard)

`adapters.spec.ts`: `toPrincipalSet()` extracts the querying user's own role, ignores other members'
roles, and drops a group where the user is absent.

### Unit — `libs/data`

`groups.repository.spec.ts`:
- `setMember()` issues `$pull` then `$push` (**no duplicate row when re-adding an existing member
  with a different role** — the trap above, asserted explicitly)
- `findForMember()` queries `members.userId`, still tenant-scoped
- `removeMembers()` `$pull`s by `members.userId`

### Unit — `libs/auth`

New invite-token spec: 24h TTL; a token past `inviteExpiresAt` is invalid; a wrong token is invalid;
validation is timing-safe; `isResetTokenValid` re-export still behaves identically (regression).

### Unit — `apps/api`

`groups.controller.spec.ts`: membership update carries roles; a **role-only** change still bumps
`permVersion` and audits; `toSummary()`'s member shape; membership still withheld from non-admin
non-members.

`tenant-users-admin.controller.spec.ts`:
- `create()` → `status: 'pending'`, invite email sent, **no `tempPassword` in the response**
- duplicate email → 409
- `update()`: email uniqueness excluding self (a no-op same-email PATCH must **not** 409);
  role change calls `sessions.revokeAll`; email change on a pending user re-issues the invite
- `resendInvite()`: 409 unless `pending`; mints a new token
- `reactivate()`: `activatedAt` set → `active`, no email; `activatedAt` absent → `pending` + email
- `deactivate()` unsets the invite token
- CSV: valid `groups` cell creates memberships with the right roles; unknown group name → row error
  and **no user created**; invalid role → row error; empty cell → created with no memberships

`auth.controller.spec.ts`:
- activation happy path sets `passwordHash` + `active` + `activatedAt`, unsets invite fields
- expired / wrong / already-consumed token → 401
- password < 12 chars → rejected; breached password → 400
- a `pending` user cannot log in
- a `pending` user's `password-reset/request` sends nothing (the bypass closed above)

### Integration — `apps/api/test/` (real in-process Mongo, full guard chain)

Extend `folders-permission-matrix.integration.spec.ts` — **the highest-value tests here**, since
they prove enforcement end-to-end through `requireTier`, not just the pure function:
- viewer-role member: `GET` folder OK, document upload/rename/delete → 403
- editor-role member: mutations OK, grant/revoke → 403
- manager-role member: grant/revoke OK
- changing a member's role invalidates the permission cache (old tier not served from cache)
- cross-tenant: a member of a same-named group in tenant B gets nothing in tenant A

New `user-invitation.integration.spec.ts` (fake notification provider captures the email):
- create → email captured → token extracted from the body → activate → **log in successfully**
- expired invite → 401, user stays `pending`
- deactivating a pending user kills the outstanding link (activation then 401s)
- reactivating a never-activated user sends a *new* working invite
- an invite token for tenant A's user cannot activate a tenant B account

### E2E — `apps/web/e2e/`

New spec: admin creates a user → invite email captured from the harness → `/activate` → set password
→ log in as the new user. Plus a group-role spec: set a member to viewer, confirm the edit controls
are absent for them.

**Pre-existing blocker to fix first:** `folders-groups.spec.ts:15` hardcodes
`TOTP_SECRET = 'ERVVGRZMM5NWYM2O'`, but `dev-server.ts` mints a fresh secret every boot — so the
suite can only pass against the one seed run it was written against (confirmed: both tests currently
time out at TOTP). New specs must read the secret from the harness. Fixing the existing two is a
small, worthwhile side-quest at the start of Phase 4.

---

# Task ledger

Phases are ordered so the security core lands first and each phase is independently green.

| # | Task | Files | Done |
|---|---|---|---|
| **1** | **Permissions core (pure, no I/O)** | | |
| 1.1 | `GroupMemberRole`, `GROUP_ROLE_TIER`, `PrincipalSet.groups`, `DecidingGrant.cappedFrom` | `libs/permissions/src/types.ts` | [DONE] |
| 1.2 | Cap logic in the grant loop + full spec matrix | `resolve-permissions.ts`, `.spec.ts` | [DONE] — 6 new capping cases, 51/51 unit tests green |
| 1.3 | `toPrincipalSet()` role extraction + spec | `adapters.ts`, `.spec.ts` | [DONE] |
| **2** | **Data layer** | | |
| 2.1 | `Group.members[]` + `{tenantId,'members.userId'}` index | `libs/data/src/models/group.schema.ts` | [DONE] |
| 2.2 | `setMember()` ($pull+$push), `removeMembers()`, `findForMember()` + specs | `groups.repository.ts`, `.spec.ts` | [DONE] — 95/95 libs/data unit tests green |
| 2.3 | `User`: `'pending'` status, `inviteTokenHash`, `inviteExpiresAt`, `activatedAt` | `libs/data/src/models/user.schema.ts` | [DONE] |
| 2.4 | Update every `memberUserIds` reader (membership service, notification dispatch, test fixtures, dev-server) | 6 files + specs | [DONE] — `seedGroup()` fixture kept `memberUserIds` back-compat (defaults to `manager` role) so `dev-server.ts`/cross-tenant specs needed zero changes |
| **3** | **API** | | |
| 3.1 | `createToken(ttlMs)` extraction + `createInviteToken()` + spec | `libs/auth/src/password-reset.ts`, `invite.ts` | [DONE] — 48/48 libs/auth unit tests green |
| 3.2 | Contracts: `GroupMemberRole` in group DTOs, `UpdateUserRequestSchema`, CSV `groups` column, activation DTOs | `libs/contracts/src/*` | [DONE] |
| 3.3 | `create()` → pending + invite email; drop `tempPassword` | `tenant-users-admin.controller.ts` | [DONE] |
| 3.4 | `PATCH /users/:id` (email uniqueness, role→revokeAll, group diffing) | same | [DONE] |
| 3.5 | `resend-invite`; `reactivate()`/`deactivate()` branches | same | [DONE] |
| 3.6 | CSV `groups` column (name→id resolution, row-level errors) | same | [DONE] |
| 3.7 | `activate/check` + `activate/confirm`; close the pending-user reset bypass; reject pending at login | `auth.controller.ts` | [DONE] — login already rejected non-active status, no change needed there |
| 3.8 | Group membership roles + permVersion bump on role change | `groups.controller.ts` | [DONE] |
| 3.9 | Integration suites (permission matrix extension + invitation flow) | `apps/api/test/` | [DONE] — 13/13 permission-matrix (6 new), 6/6 invitation-flow; 34/34 full integration suite; 290/290 apps/api unit; `nest build` clean |
| **4** | **Web** | | |
| 4.1 | Fix the hardcoded-TOTP e2e blocker | `apps/web/e2e/folders-groups.spec.ts` | [DONE] — `dev-server.ts` now defaults to the exact secret the spec already hardcoded (`SEED_TOTP_SECRET` env overrides it), instead of a fresh random one per boot |
| 4.2 | Shared group+role picker component | `apps/web/components/group-role-picker.tsx` | [DONE] |
| 4.3 | `/users`: pending badge, resend action, edit link, no temp-password banner | `app/users/page.tsx` | [DONE] |
| 4.4 | `/users/[id]` edit screen | `app/users/[id]/page.tsx` | [DONE] |
| 4.5 | `/groups/[id]` per-member role selector | `app/groups/[id]/page.tsx` | [DONE] |
| 4.6 | `/activate` screen | `app/activate/page.tsx` | [DONE] |
| 4.7 | E2E specs (create→pending→resend; group role add/change/persist) | `apps/web/e2e/folders-groups.spec.ts` | [DONE] — 3/3 pass against a live dev-server.ts + next dev harness; full invite→activate→login round trip is covered at the API layer (`user-invitation.integration.spec.ts`) since only that layer can capture the emailed token |
| **5** | **Cutover** | | |
| 5.1 | Reset script: drop `groups`, strip `principalType:'group'` grants from folders | scratch script | Not run — no live deployment happened this session. Not needed for correctness either: `Group.members` defaults to `[]`, so any pre-existing `memberUserIds`-shaped doc just reads back as an empty-membership group rather than erroring. Still do the explicit reset before any real deploy, per decision 6. |
| 5.2 | Rule 4 quality pipeline; `pnpm turbo run build lint test:unit` + integration green | — | [DONE] — 33/33 turbo tasks, 34/34 apps/api integration tests, live-verified via Playwright MCP (zero console errors) and 3/3 real e2e specs. Full CI job mapping also verified locally (lint/build/unit/integration/cross-tenant/gitleaks) — see below. |
| 5.2b | Security-reviewer pass (Snyk not authenticated in this environment) + fix findings in scope | — | [DONE] — 14 findings (2 High, 5 Medium, 7 Low). 5 fixed + tested (resolver fail-open, activate/check GET->POST, deactivate token/activatedAt handling, tenant-users-admin ObjectId+ZodError guards). Both High findings resolved with the user's go-ahead (2026-08-24): `apps/mfa.sh` + the stray `.bak` deleted, `*.bak` added to `.gitignore`; `multer` bumped `^1.4.5-lts.1` -> `^2.2.0` in **both** `apps/api` and `apps/portal-api` (the security review said only portal-api was affected — checked the lockfile directly and found apps/api pinned the identical vulnerable version too; the `2.0.2` already in the lockfile was an unrelated transitive dep neither app used). Remaining Medium/Low findings are real but out of this plan's scope — see "Security review findings" section below. |
| 5.3 | Update root `CLAUDE.md` (Rule 5) | `CLAUDE.md` | [DONE] |

## Cutover / data reset

Per decision 6, no migration is written (ADR-0010's `migrations/` package still does not exist).
Nothing has shipped to a real customer; the Atlas M0 behind the live VM holds demo data only.

Reset = drop the `groups` collection **and** strip `principalType: 'group'` grants from `folders`.
The second half matters: a grant pointing at a deleted group is *harmless* to the resolver (the
principal key simply never matches, so it grants nothing) but leaves confusing dead entries in the
C3 permissions UI. Clean both.

## Deviations from `docs/adr/Users_management.md`

Recorded so the ADR and the build do not silently diverge:

1. **Two name fields, not one "Full Name"** — owner decision 1, overrides the ADR's §2.A.
2. **Roles**: the ADR's Viewer/Editor/Admin is a *tenant-wide* role trichotomy. Built instead as a
   2-tier tenant role (`user`/`admin`, unchanged — it is load-bearing for `AdminOnlyGuard` and the
   whole permissions library) **plus** a per-group viewer/editor/manager role. This is the owner's
   refined model and is strictly more expressive.
3. **Password floor 12, not 8** — decision 1; the ADR is silent, the owner said 8, the existing
   system-wide floor wins.
4. **Not in this plan** (ADR §1.A–B, §D): table search + 300ms debounce, status/role filters,
   pagination, deactivate confirmation modal, XLSX import, downloadable error report, bulk
   "assign selected users to groups", and the toggle-grid with indeterminate state. All are
   list-ergonomics features that make sense at a user count no tenant has yet; none block the four
   requirements above. Track separately.

## Security review findings (2026-08-24)

Snyk wasn't authenticated in this environment, so a `security-reviewer` agent pass ran in its
place per Rule 4's fallback. 14 findings (2 High, 5 Medium, 7 Low), full detail in the review
transcript. Disposition:

**Fixed + tested this session** (all in code this plan wrote):
- Resolver fail-open on a malformed/out-of-enum `access` value — `min()` fell through to the
  uncapped side instead of denying (`libs/permissions/src/resolve-permissions.ts`).
- `GET /auth/activate/check` put the raw single-use invite token in the URL (browser history,
  Referer header) — changed to `POST`, body-only, matching `activate/confirm`.
- `deactivate()` only unset the invite token pair, not the sibling `passwordReset*` pair — a reset
  token issued shortly before deactivation stayed live through a later reactivate.
- `reactivate()`'s `activatedAt` heuristic had no signal for any account created before this
  session's flow existed (every already-seeded admin included) — would have force-reset every
  legacy account to `'pending'` on its first deactivate+reactivate. Fixed by lazily backfilling
  `activatedAt` at the one moment `deactivate()` still knows the prior status.
- `TenantUsersAdminController` had neither an ObjectId shape guard on `:id` nor `FolderExceptionFilter`
  for `ZodError→400`, unlike its sibling controllers — malformed input 500'd instead of 400/404ing.

**Both High findings, resolved 2026-08-24 with the user's explicit go-ahead** (pre-existing, outside
this plan's scope, but fixed once flagged):
- `apps/mfa.sh` (untracked, unignored, predates this session) — a live-looking hardcoded TOTP seed.
  Deleted, `*.bak` added to `.gitignore` alongside it. Whether it belonged to a production account
  — and therefore needed rotating — was the user's call, not determinable from the repo; that's on
  them to action outside this repo if so.
- `multer@^1.4.5-lts.1` (EOL, 3 HIGH CVEs) — the review said only `apps/portal-api` was affected;
  checking the lockfile directly showed `apps/api` pinned the identical vulnerable version too (the
  `2.0.2` present in the lockfile was an unrelated transitive dependency neither app actually used).
  Bumped both to `^2.2.0` (`multer` + `@types/multer`), `pnpm install` to refresh the lockfile,
  rebuilt + retested both apps (297/297 apps/api unit, 37/37 integration, 45/45 + 6/6 portal-api) —
  `memoryStorage()`/`MulterError`/`FileInterceptor` usage is unchanged across the major version.
- `apps/portal-api/src/platform-admin/tenants.controller.ts.bak` — a stray, identical backup copy. Deleted.

**Real but deliberately deferred** (would expand scope beyond this plan):
- `groups-membership.service.ts`'s `isMember()` stays role-agnostic for calendar/kanban — already
  documented above as an open item; confirmed by the review as a real scope call, not a bug.
- Portal-api's `provision()`/MFA-reset still return a plaintext `tempPassword` — the exact pattern
  this plan replaced for tenant users, just not ported to the portal-api tenant-provisioning path.
- No rate limiting on `activate/check`, `activate/confirm`, `password-reset/request`, or
  `resend-invite` (outbound-email-abuse / mailbox-flooding risk, not token-guessing — tokens are
  128-bit).
- `password-reset/request`'s enumeration-timing gap (the `sendEmail` await sits inside the
  active-user branch) — pre-existing, not introduced by this plan's `status === 'active'` change.
- `updateMembers()` doesn't validate `add[].userId` resolves to a real tenant user (data-integrity
  only — confirmed NOT cross-tenant-exploitable, since reads stay tenant-scoped regardless).
- No CSP in `deploy/Caddyfile` (infra-wide, pre-existing).
- Global email uniqueness leaks cross-tenant registration status via the 409 on user-create —
  pre-existing, inherent to the current no-per-tenant-login-routing model, accepted risk.
