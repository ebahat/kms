# User Scenarios — Status Reality Check (v01, 2026-08-21)

Every scenario below was verified against the actual code (`apps/web/app/**`, `apps/api/src/**`,
`apps/portal-api/src/**`), not assumed from the spec. Status legend:

- ✅ **UI + API** — has a working frontend page calling a working backend endpoint.
- 🔧 **API only** — backend endpoint exists and works; no frontend page exists to drive it. Must be
  called directly (curl/Postman with a valid session cookie).
- ❌ **Not built** — neither UI nor backend exists yet (out of v1.0 scope, or genuinely unbuilt).

Source of truth for the intended scope: `docs/ui/screens_spec_v01.md` (screen IDs A1/B2/C1/etc.
reused below for traceability). Source of truth for what's real: the grep/read pass done 2026-08-21
(see cross-references per item).

## Known gaps blocking self-serve onboarding today

- **C1 — user management** was built 2026-08-21 (`docs/plans/c1-user-management-ui-21-08-2026-plan.md`):
  `apps/web/app/users/page.tsx` covers list/create/deactivate/reactivate/CSV-import, linked from
  `/home`'s nav for admins. MFA reset is still not covered here — that's the separate platform-admin
  two-person flow below.
- **Tenant creation has no UI.** `apps/web/app/admin/home/page.tsx` only lists tenants (read-only);
  there's no create form. Backend (`apps/portal-api/src/platform-admin/tenants.controller.ts`)
  fully works: create/suspend/reactivate/quota.
- **Password reset has no UI.** Backend `password-reset/request` + `password-reset/confirm` exist
  and work; `/password-reset` 404s in the browser.

None of these are silent failures — the backend returns correct responses, there is simply nothing
in `apps/web/app` to call it from. This is a coverage gap between Phase 1 (backend) and the Phase 2
UI pass, which built folders/groups but not C1.

---

## A. Authentication & session (all editions)

| ID | Scenario | Status | Notes |
|---|---|---|---|
| A1 | Tenant login (email + password) | ✅ | `apps/web/app/login/page.tsx`; identical error/timing for unknown-user vs wrong-password |
| — | Platform-admin login | ✅ | `apps/web/app/admin/login/page.tsx`, separate realm/guard chain |
| — | Mandatory TOTP enrollment | ✅ | `apps/web/app/login/totp/page.tsx` — auto-fires on first login when unenrolled; **destructive if re-triggered**, see production-smoke.spec.ts comment |
| — | TOTP challenge (already enrolled) | ✅ | same page, `needsEnroll=false` branch |
| — | Login lockout / progressive delay / CAPTCHA hook | ✅ (CAPTCHA is a no-op) | `libs/auth/src/login-hardening.ts`; `NoopCaptchaVerifier` always passes — CAPTCHA never actually blocks in this deployment |
| — | Password reset (request + confirm) | 🔧 | endpoints exist, `/password-reset` page doesn't |
| — | Two-person MFA reset (admin-assisted) | 🔧 | portal-api endpoint exists per CLAUDE.md; no UI found |
| — | Session expiry (idle/absolute) | ✅ | enforced server-side via `SessionService` |
| — | ToS acceptance gate | ✅ | `apps/web/app/tos-accept/page.tsx` |

## B. Knowledge Base — tenant user

| ID | Scenario | Status | Notes |
|---|---|---|---|
| B2 | Folder tree + document browser | ✅ | `apps/web/app/folders`, `apps/web/app/folders/[id]` — read-only document list (no upload/preview UI beyond listing per CLAUDE.md) |
| — | Group browsing (view membership) | ✅ | `apps/web/app/groups`, `apps/web/app/groups/[id]` — open to any authenticated user per controller, not just admins |
| B8 | Favorites | ❌ | not built |
| — | Chat with AI | ❌ | Phase 3/4, shown as a plain `<span>` in nav, deliberately deferred |
| — | Upload / download documents | 🔧/partial | upload+signed-URL backend exists (Phase 2A side effect); no dedicated upload UI (drag-drop is explicitly out of scope, B3–B5) |
| — | Version history | ❌ | out of scope (B3–B5), assumes Phase 3 |

## C. Knowledge Base — tenant admin

| ID | Scenario | Status | Notes |
|---|---|---|---|
| C1 | Create user | ✅ | `apps/web/app/users/page.tsx`, built 2026-08-21 |
| C1 | Deactivate / reactivate user | ✅ | same page |
| C1 | CSV bulk import | ✅ | same page, `<input type="file">` + `FileReader` |
| C1 | MFA reset for a user | 🔧 | not covered by the new page — see platform-admin two-person flow below |
| — | Create / rename / move / delete folder | ✅ | `apps/web/app/folders/[id]` |
| C3 | Grant / revoke folder permissions, "why can Dana see this" | ✅ | `apps/web/app/folders/[id]/permissions` |
| — | Create / delete group, manage membership | ✅ | `apps/web/app/groups`, `apps/web/app/groups/[id]` |
| — | Public-folder toggle, permission-widening badge | ✅ | part of the folder tree/detail UI |
| C5 | Tenant analytics (usage, knowledge-gap dashboard) | ❌ | P1, not built |
| C7 | Tenant settings (default language, OCR policy, retention) | ❌ | P1, not built |
| — | Calendar / Kanban (events, tasks) | 🔧 | backend complete (Phase 2A) and opt-in per tenant via module entitlement (off by default); UI descoped to v1.1 on 2026-08-15 |

## D. Smart OCR (OCR-E) — standalone edition

| ID | Scenario | Status | Notes |
|---|---|---|---|
| D1 | Personal directory (own files, 7-day auto-delete) | ❌ | not started — OCR edition (Phase 3+) |
| D4 | OCR-E admin (users/quotas/engine enforcement) | ❌ | not started |

## E. Platform admin (cross-tenant)

| ID | Scenario | Status | Notes |
|---|---|---|---|
| — | List tenants | ✅ | `apps/web/app/admin/home/page.tsx` |
| — | Create tenant | 🔧 | `POST /platform-admin/tenants` — **see gap above** |
| — | Suspend / reactivate tenant | 🔧 | endpoint exists, no UI |
| — | Set tenant quota | 🔧 | endpoint exists, no UI |
| — | Two-person MFA reset for a tenant admin | 🔧 | backend exists per CLAUDE.md, no UI confirmed |
| E3 | Cross-tenant analytics & billing | ❌ | P1, not built |

---

## Where this leaves you right now

C1 is built. Tenant creation and password reset are still API-only — the only path for those is a
direct API call (curl, with a valid session cookie) against `/platform-admin/tenants` or
`/password-reset/*`. Both are pure frontend work against endpoints that already pass their own
tests, same shape of gap C1 was.
