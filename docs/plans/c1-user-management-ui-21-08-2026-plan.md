# C1 — Tenant user-management screen (frontend only)

Status: DONE. 2026-08-21.

## Why

Confirmed gap (see `docs/ui/user-scenarios-v01.md`): `TenantUsersAdminController`
(`apps/api/src/tenant-admin/tenant-users-admin.controller.ts`) fully implements
list/create/deactivate/reactivate/CSV-import, all covered by its own unit spec. No frontend page
calls any of it — `apps/web/app/home/page.tsx` renders "ניהול משתמשים" as a plain `<span>` with a
comment saying so explicitly. This is backend-only work turned into a real screen; **no backend
changes** are in scope.

Out of scope, deliberately: MFA reset (that's the platform-admin two-person flow in
`apps/portal-api/src/platform-admin/mfa-reset.controller.ts`, a different realm/screen, not part of
`TenantUsersAdminController`); tenant creation UI and password-reset UI (separate gaps, not
requested here).

## Design, matching existing `/groups` and `/folders` conventions

- `apps/web/lib/users-api.ts` — thin `tenantApi` wrapper, same shape as `lib/groups-api.ts`:
  `list()`, `create({email, role})`, `deactivate(id)`, `reactivate(id)`, `importCsv(csvContent)`.
- `apps/web/app/users/page.tsx` — single page (list is short enough not to need a detail route):
  - `useSession()` guard, redirect non-admins (list endpoint has no admin gate server-side per the
    controller, but create/deactivate/reactivate/import all do — mirror the `session.role==='admin'`
    conditional-render pattern used in `/groups`).
  - Table: email, role, status, mfaEnabled, lastLoginAt. Deactivate/reactivate button per row
    (admin-only), matching the `/groups/[id]` remove-member button pattern.
  - Create-user inline form (email + role select) — POST returns `{userId, email, tempPassword}`;
    surface `tempPassword` once in a dismissible banner (there's no email delivery, sec-noted in the
    scenarios doc) since it's the only place the operator will ever see it.
  - CSV import: `<input type="file">` read via `FileReader.readAsText`, POST the raw text (backend
    parses CSV server-side — no client-side CSV parsing needed), render `results[]` (row/email/status/error)
    in a table so per-row failures are visible instead of an opaque success/fail.
- `apps/web/app/home/page.tsx` — change the `session.role === 'admin' && <span>ניהול משתמשים</span>`
  line to a real `<Link href="/users">`.

## Steps

1. [DONE] Investigate existing gap, confirm backend contract shapes (`UserSummary`,
   `CreateUserRequestSchema`, `CsvImportRowResult`), read `/groups` + `/groups/[id]` as the
   convention template.
2. [DONE] `apps/web/lib/users-api.ts`
3. [DONE] `apps/web/app/users/page.tsx`
4. [DONE] Wire up `apps/web/app/home/page.tsx` nav link
5. [DONE] `pnpm --filter @kms/web build` + `pnpm --filter @kms/web lint` green
6. [DONE, partial] Code-quality pipeline (Rule 4, 3-file feature): a `oh-my-claudecode:code-reviewer`
   subagent was launched but returned no extractable findings after three follow-up prompts (kept
   replying "Idle." with zero tool calls on resume — its `ReportFindings` output, if any, did not
   surface to the orchestrator; possibly rendered only to a host UI channel not visible here).
   Did a manual self-review instead and found one real issue: the `/users` page's top comment
   incorrectly claimed `list()` has no server-side admin gate — `TenantUsersAdminController`'s
   `@UseGuards(AdminOnlyGuard)` is actually class-level, so every route including `list` 403s for
   non-admins. Fixed the comment to state this correctly. No functional/security defect (server
   already enforced this correctly; only the comment was wrong).
7. [DONE] e2e: added a new `C1 golden path` test to `apps/web/e2e/folders-groups.spec.ts` (create
   a user with a random email, assert it appears, deactivate it, assert status flips). Random
   email suffix per Rule 3.

## Verification

- `pnpm --filter @kms/web build` — green (new `/users` route compiles, 2.53 kB).
- `pnpm --filter @kms/web lint` — clean, before and after all edits.
- Ran both e2e tests live against a real `dev-server.ts` harness + real `next dev` — the
  pre-existing golden path and the new C1 test both passed. Harness moved from port 3000 to 4000
  (see below) to avoid a conflict with an unrelated long-running process on this machine.
- Found and fixed, unrelated to this feature's own code: `folders-groups.spec.ts`'s `TOTP_SECRET`
  constant is a manual-paste value that must be refreshed from `dev-server.ts`'s printed secret
  each time someone runs a fresh harness (secret is generated randomly per boot, not seeded) —
  this is the file's existing, documented, intentional design ("meant to run against that exact
  seed, not arbitrary data"), not something introduced or fixed here; noted for awareness since it
  surprised me on first run.
- `apps/api/test/support/dev-server.ts` now listens on port 4000 by default (`DEV_HARNESS_PORT`
  env override available), not 3000 — changed 2026-08-21 per user direction, since this machine
  also runs an unrelated process on :3000 for a different project. Point `apps/web`'s dev server at
  it with `NEXT_PUBLIC_API_URL=http://localhost:4000` when doing manual/e2e work against this
  harness going forward.
