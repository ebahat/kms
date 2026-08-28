# Master plan: retro gaps + Stitch design-system adoption + superuser screen

Status: Phases A and B DONE; Phase C1 DONE (2026-08-22); Phase C2 PLANNED, not started.
Scope confirmed via AskUserQuestion (2026-08-22):
retro's 4 actions; Stitch screens limited to B1/C1/C2/C3/C4 (skip B4/B5/B6/D1/C6 — Phase 3/4-dependent
or backend-less); adopt Tailwind + the Stitch token system across the whole app, not just new
screens; superuser screen gets **real** per-tenant subdomain routing, not metadata-only.

Executed as three phases, in order, with a status check-in between each rather than one
uninterrupted run — this is multi-day-scale work.

---

## Phase A — the retro's 4 actions

From the 2026-08-21 CORS/login retro (never actually completed before this session got
redirected to C1). Small, independent, no dependency on Phases B/C.

1. [DONE] **Bootstrap smoke test** — `apps/api/test/bootstrap.integration.spec.ts`. Verified it
   catches the regression class: temporarily removed `@Edition('kb')` from `FoldersController`,
   confirmed the test fails with the exact ADR-0009 G2 error, restored the decorator, confirmed
   green again.
2. [DONE] **Password-reset UI** — `/password-reset` (request, uniform response regardless of
   whether the email exists) + `/password-reset/confirm` (reads `email`/`token` from the query
   string, Suspense-wrapped per Next.js requirement). Also wired `AuthController.requestPasswordReset`
   to actually send the email via `NOTIFICATION_PROVIDER` (it never had before — its own comment
   said delivery was "pending a transactional email provider decision," which ADR-0013 already
   resolved for Phase 2A but nobody circled back to this endpoint). Added `APP_PUBLIC_URL` to
   `deploy/docker-compose.yml` so the API can build a real reset link. 3 new unit tests
   (`auth.controller.spec.ts`) + build/lint clean on both `api` and `web`.
   **Found, not fixed (separate gap, flagged in the compose file):** `RESEND_API_KEY` was never
   actually set in `docker-compose.yml` either, meaning every Phase 2A "always-on" invite/task
   email has been silently running on `FakeNotificationProvider` in production — nothing has
   really been emailed yet, calendar/kanban being v1.1/unbuilt-UI notwithstanding.
3. [DONE] **Retro saved** to `docs/architecture/deploy-retro-21-08-2026-review.md`.
4. [DONE] **Deploy script** — `deploy/smoke-deploy.sh`: build+push all 3 arm64 images (correct
   `NEXT_PUBLIC_API_URL=/api` build arg) → SSH deploy → wait for `/health` → run
   `production-smoke.spec.ts` against the live URL → non-zero exit if it fails. Syntax-checked
   (`bash -n`), NOT executed against the live VM (would touch shared production infra — needs its
   own explicit go-ahead, separate from writing the script). Also fixed while here:
   `deploy/README.md`'s documented build command still showed the pre-fix, cross-origin
   `NEXT_PUBLIC_API_URL=https://api.<domain>` — stale docs that would have silently reintroduced
   Bug 1 if anyone followed them manually.

**Phase A complete.**

## Phase B — Design-system adoption + screen restyle

Depends on nothing from Phase A. `apps/web` currently has zero CSS framework (inline `style={}`
everywhere). Adopting `stitch_automated_document_reviewer/`'s token system is a foundational,
whole-app change.

1. [DONE] Added Tailwind v4 to `apps/web` (`@tailwindcss/postcss`, CSS-first `@theme` block in
   `app/globals.css`) — encoded from the *per-screen* embedded tailwind.config in b1/c1/c2/c3/c4's
   own `code.html` (all five identical to each other), not the master YAML doc, which had drifted
   slightly from what was actually generated/reviewed. Rubik + Courier Prime + Material Symbols
   Outlined loaded via `<link>` tags in `app/layout.tsx` (matches the mockups' own loading method,
   avoids a next/font build-time network dependency).
2. [DONE] `components/app-shell.tsx` — real tenant name (see below), edition-aware nav
   (folders/groups/chat-placeholder/favorites-placeholder/queue-placeholder, admin-only "ניהול" →
   `/users`), logout. Storage-quota banner not built — no quota-consumed data is plumbed to the
   frontend yet, would have been a fake number.
   **Found + fixed while building this:** `/auth/session` never returned the tenant's name, so the
   shell would have shown a placeholder forever. Added `tenantName` to `AuthController.getSession()`
   (new unit test), real data end-to-end.
3. [DONE] Restyled `/login`, `/login/totp`, `/home`, `/tos-accept`, `/admin/login`,
   `/admin/home`, `/admin/login/totp` onto the token system (`/home` now mounts `AppShell`; the
   auth screens keep the same centered-card shape, just Tailwind instead of the old `globals.css`
   `.auth-*` classes — `/login`'s error div kept the literal `auth-error` class name too, since
   `production-smoke.spec.ts` locates it by that selector).
4. [DONE] Restyled `/folders`, `/folders/[id]`, `/folders/[id]/permissions` (C3) onto `AppShell` —
   C3's ACL table shows access as a single 3-tier badge (read/edit/manage) rather than forcing the
   mockup's independent read/edit toggle switches onto a data model that doesn't have two
   independent booleans.
5. [DONE] Restyled `/groups`, `/groups/[id]` (C2) onto `AppShell`.
6. [DONE] Restyled `/users` (C1) onto `AppShell` + added a cross-link to the new recycle-bin screen.
7. [DONE] Built C4 — `/recycle-bin`, real typed-`DELETE`-confirmation purge dialog. **Backend gap
   found and closed**: `RecycleBinEntriesRepository.findPending()` already existed with a comment
   anticipating exactly this screen, but no controller route ever exposed it — only per-id
   restore/purge existed, no list. Added `GET /recycle-bin` (admin-gated, matching restore/purge)
   to `documents.controller.ts`, a `RecycleBinEntrySummary` contract type, resolves each entry's
   folder name (null-safe if the folder was itself deleted), 2 new unit tests. The mockup's bulk
   "רוקן סל מיחזור" (empty bin) button is deliberately not built — no batch-purge endpoint exists,
   and faking one client-side (loop of per-entry purges) would have different atomicity/failure
   semantics than a real bulk action, never asked for.
8. [DONE] Fixed e2e locators broken by the restyle: `folders-groups.spec.ts`'s nav-copy locators
   (`'תיקיות'` → `'דפדפן מסמכים'`, `'ניהול משתמשים'` → role-based `'ניהול'` match). **Also found
   and fixed a real accessibility bug this surfaced**: three icon-only buttons (`/users`
   deactivate/reactivate, `/groups/[id]` delete-group and remove-member, C3's revoke-grant "×")
   used only a `title` attribute for their tooltip — but each button's only *content* is a Material
   Symbols ligature span (e.g. literal text "block"), and per the accname algorithm, visible text
   content wins over `title` for the accessible name. A screen reader would have announced "block"
   instead of "השבת". Added `aria-label` to all four, matching what `title` already said.
   Full suite verified live against a real browser + real `dev-server.ts` harness: both
   `folders-groups.spec.ts` tests pass (including the new C4 endpoint exercised through the running
   app, confirmed error-free via console + accessibility-snapshot checks on every restyled screen).

**Phase B complete.** `pnpm build`/`pnpm lint` clean throughout; `apps/api` full unit suite green
(260 tests) after the `getSession`/recycle-bin backend changes.

## Phase C — Superuser tenant + user creation screen (real subdomain routing)

Status: **C1 DONE (2026-08-22)** — schema, atomic tenant+admin provisioning, logo upload, theme
color, and the superuser frontend screen are built, tested, and live-verified (including two real
bugs found and fixed during that verification: a missing OCI env-var block on portal-api's deploy
config, and a storage-signing content-disposition issue that would have kept tenant logos from
rendering). **C2 (real per-tenant subdomain routing) remains PLANNED, not started** — genuinely new
production infra, gated on separate explicit approval per its own sequencing section. Full detail
(design, implementation record, and live-verification notes) is in its own document:
**`docs/plans/superuser-subdomain-provisioning-22-08-2026-plan.md`** — this section stays a short
pointer rather than duplicating that content.

## Verification

Fill in per phase as completed.
