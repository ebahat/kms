# Phase C: superuser tenant+user provisioning + per-tenant subdomains

Status: **C1 is DONE (2026-08-22, implemented and live-verified).** C2 (real per-tenant subdomain
routing) remains PLANNED, not started — it is genuinely new production infrastructure and stays
gated on a separate explicit go-ahead per its own C2.5 sequencing section below. This is the
detailed design for Phase C of `docs/plans/master-gaps-design-superuser-22-08-2026-plan.md`
(Phases A and B of that plan are DONE; see that file for their record). See "C1 — Implementation
record" near the end of this document for what was actually built, what changed from the original
design during implementation, and what live verification did and did not cover.

## Scope recap

From the original request: a superuser screen to create a tenant + its first admin, with a
subdomain, a logo upload, and a theme main color (RGB) — and the user explicitly chose **real**
per-tenant subdomain routing over a metadata-only field, when asked.

## Recommended restructuring: split into C1 (safe) and C2 (infra-risk)

While designing this, one structural fact changes the risk profile enough to flag prominently
before any implementation starts:

**Logo and theme-color branding do not need subdomain routing at all.** Both are consumed
*post-login*, via the same `/auth/session` endpoint the app shell already calls (Phase B wired
`tenantName` through exactly this path). Subdomain routing is only load-bearing for one specific
capability: showing the *right* tenant's branding on the **login page**, before the user has
authenticated — because pre-login, the only signal available is which hostname was requested.

Given that, this plan is split into two independently shippable sub-phases:

- **C1 — schema, atomic provisioning, logo, theme, the superuser screen itself.** Zero DNS/TLS/Caddy
  changes. Ships through the existing deploy pipeline unchanged. Delivers everything a tenant
  admin or their users would actually *see* as "branding" (logo + color, everywhere, immediately
  after login) plus the full superuser workflow the user asked for.
- **C2 — real per-tenant subdomains.** Wildcard TLS (DNS-01), Caddy reconfiguration, DNS changes,
  a new hostname-resolution layer, a new pre-login public branding endpoint. This is the piece
  that carries real production risk and infra cost/complexity.

**Recommendation:** build and ship C1 first, then decide whether C2's specific payoff (branded
*URL* + pre-login branding) justifies its infra cost, now that C1 already delivers branded
*screens*. This isn't a unilateral descoping — C2 is fully designed below and nothing here removes
it from scope — it's a sequencing call worth confirming before starting implementation, since C1
alone may satisfy the actual need.

---

## C1 — Schema, atomic provisioning, logo, theme, superuser screen

### C1.1 — Schema changes (`libs/data/src/models/tenant.schema.ts`)

Add three fields to `Tenant`:

```ts
@Prop({ trim: true, lowercase: true })
subdomain?: string; // unique DNS label — see C1.4 validation. Optional so existing/unrouted
                     // tenants keep working; enforced at the API layer, not a bare Mongoose unique
                     // index alone (see indexing note below).

@Prop()
logoObjectKey?: string; // Object Storage key, same bucket/provider as documents (StorageProvider)

@Prop()
themeColorRgb?: string; // '#rrggbb' — validated by zod on write, never trusted raw from the DB on read
```

Index: `TenantSchema.index({ subdomain: 1 }, { unique: true, sparse: true })` — `sparse` so the
many existing/未set tenants (`subdomain: undefined`) don't collide with each other under a unique
index (Mongo unique indexes ignore documents missing the field when `sparse: true`).

**Migration:** ADR-0010's `migrations/` package still doesn't exist (noted as a gap in every prior
phase's status). Given the only tenant with real data today is the seeded demo tenant, a full
migration framework is overkill here. Plan: additive fields only, no backfill required for
correctness (undefined subdomain = "not reachable via subdomain yet", which is already true for
every existing tenant and doesn't break anything they currently do). If the demo tenant should get
a subdomain retroactively, that's a one-off manual `updateOne`, not a migration.

### C1.2 — Atomic tenant + first-admin creation

**Problem this solves:** today only `apps/api/src/bootstrap/seed.ts` (a standalone script, not an
API) can create a tenant's first admin — it works by directly setting a synthetic CLS scope and
calling `UsersRepository.create()` in-process, bypassing the normal "admin session already exists"
requirement that `TenantUsersAdminController.create()` has. There is no API path to do this today;
the superuser screen needs one.

**Design:** extend `apps/portal-api/src/platform-admin/tenants.controller.ts`'s existing
`POST /platform-admin/tenants` (currently `TenantsController.create()`, `CreateTenantRequestSchema`
→ `{name, edition, storageQuotaBytes?}`) to also create the first admin, atomically, in the same
request. Rationale for extending the existing endpoint rather than adding a new one: the superuser
form is a single submit for "one new tenant," and a tenant with no admin at all is a useless,
half-finished state — there's no legitimate reason to allow creating one without the other via
this screen.

New request/response contracts (`libs/contracts/src/tenant-dto.ts`, extending the existing file):

```ts
export const ProvisionTenantRequestSchema = z.object({
  name: z.string().min(1).max(200),
  edition: z.enum(['kb', 'ocr']),
  subdomain: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, 'invalid subdomain'),
  adminEmail: z.string().email(),
  themeColorRgb: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  storageQuotaBytes: z.number().int().positive().optional(),
});

export type ProvisionTenantResponse = {
  tenantId: string;
  subdomain: string;
  adminUserId: string;
  adminEmail: string;
  tempPassword: string; // shown once, same convention as C1's tenant-admin user creation
};
```

**Reserved subdomains:** reject `api`, `admin`, `app`, `www`, `mail` (and the bare tenant `name`
slug isn't auto-derived — the superuser types the subdomain explicitly, so no surprise collisions
from name-derived slugs).

**Implementation shape** (`PlatformTenantsController`, new method or extended `create()`):

1. Validate `subdomain` uniqueness (`TenantsRepository.findBySubdomain()` — new repository method)
   before attempting the write, so a collision is a clean `409 SUBDOMAIN_TAKEN`, not a raw Mongo
   duplicate-key error surfacing to the UI.
2. Reuse `bootstrap/seed.ts`'s exact pattern for the admin-creation half: a `ClsService.run()`
   block that sets a synthetic `Scope` (`{tenantId: newTenant._id, userId: placeholderId, role:
   'admin', edition}`) and calls `UsersRepository.create()` inside it. `UsersRepository`,
   `TenantsRepository`, `hashPassword`, and the `generateTempPassword()` helper (currently private
   to `tenant-users-admin.controller.ts` — promote it to a shared `libs/auth` export, since it's
   now needed in two places under `apps/api` and `apps/portal-api`) are all already
   package-importable into `portal-api` the same way they're imported into `apps/api` — no new
   cross-service call, no new service-to-service auth mechanism needed. This was checked, not
   assumed: `libs/data`/`libs/auth` are plain workspace packages with no app-specific import
   restriction.
3. **Atomicity**: wrap tenant-create + admin-create in a MongoDB session/transaction
   (`session.withTransaction()`). Verified as viable: Atlas M0 free-tier clusters run as a 3-node
   replica set and do support multi-document transactions (this was **not** true of older
   standalone-mongod setups, which is presumably why nothing else in this codebase uses a
   transaction yet — worth confirming this is the first one, and that the test harness
   (`mongodb-memory-server`) is configured to start a replica-set-mode instance, not standalone,
   or transactions will fail only in tests, not in Atlas — a real footgun to check explicitly
   before writing the first test for this). If transaction support turns out unavailable in the
   test harness, the fallback is a compensating action (delete the tenant if admin-creation
   throws) rather than skipping atomicity — a tenant with no admin must never be left behind
   silently.
4. `auditWrite` (existing stub) records `platform-admin: provision tenant "<name>" (<subdomain>)`.

### C1.3 — Logo upload

New endpoint: `POST /platform-admin/tenants/:id/logo`, multipart (`FileInterceptor`, mirroring
`apps/api`'s document-upload pattern almost exactly — magic-byte sniff restricted to
image types (PNG/JPEG/SVG — SVG needs sanitization or exclusion given it can carry script content;
**recommend excluding SVG** for v1, PNG/JPEG only, to avoid a stored-XSS-via-logo vector), a size
cap (small, e.g. 2 MB — this is a logo, not a document), storage key
`tenants/<tenantId>/logo/<contentHash>.<ext>`.

**Portal-api currently has no `StorageProvider` binding at all** (it's never handled files). Add
one, mirroring `apps/api/src/documents/documents.providers.ts`'s `storageProviderProvider` pattern
exactly (same `OciStorageProvider`/`FakeStorageProvider` selection via env vars) — small, additive,
no behavior change for apps/api's own binding.

On success: `TenantsRepository.updateOne({_id}, {$set: {logoObjectKey}})`, delete the previous
object if one existed (avoid orphaned storage on re-upload).

**Serving — preserving the existing security invariant:** CLAUDE.md's security invariants list
"files served only via short-lived signed URLs" — a tenant logo is branding, not confidential, but
the plan is to **not** carve out an exception to that invariant for convenience. Instead:
`AuthController.getSession()` (already extended once, in Phase B, to add `tenantName`) gains a
`logoUrl?: string` field, computed via `StorageProvider.getSignedDownloadUrl(logoObjectKey)` when
the tenant has one set. The app shell already calls `/auth/session` once per load; this costs one
extra signed-URL issuance per session load, not per page, which is cheap and keeps the invariant
intact without inventing a public/long-lived logo URL path.

### C1.4 — Theme color

`themeColorRgb` (validated `#rrggbb` by the zod schema in C1.2) flows through `getSession()`
alongside `tenantName`/`logoUrl`. `AppShell` (Phase B) applies it via a CSS custom-property
override — this is precisely why Phase B's token system was built as CSS variables rather than
hardcoded Tailwind config values: overriding `--color-primary` at the DOM root (e.g.
`document.documentElement.style.setProperty('--color-primary', session.themeColorRgb)` in a
`useEffect`, or an inline `style` prop on `AppShell`'s outermost element) cascades through every
existing `bg-primary`/`text-primary`/`border-primary` utility automatically, with zero changes
needed to any of the screens built in Phase B.

**Contrast risk, worth deciding explicitly rather than shipping silently:** the mockups' token
system pairs `primary` with a fixed `on-primary: #ffffff` (white text on primary-colored
buttons/badges). A superuser-chosen color that's already light (e.g. pale yellow) would produce
white-on-white, illegible buttons — this is a real, likely-to-happen bug, not a hypothetical.
**Recommendation:** compute `on-primary` alongside `primary` rather than hardcoding white — a
simple relative-luminance check (WCAG-style: `luminance > 0.5 ? '#000000' : '#ffffff'`) run
client-side when applying the override, exposed as a second CSS variable
(`--color-on-primary-dynamic`) that Phase B's `bg-primary` consumers would need to switch to using
in place of the static `on-primary` token. This is a small but real follow-up touch across
several already-built components — flagging it now so it isn't discovered as a bug report later
instead of a planned design decision.

### C1.5 — Superuser frontend screen

New page: `apps/web/app/admin/tenants/new/page.tsx` (platform-admin realm, `admin.<domain>`),
linked from `/admin/home` (which currently only lists tenants — add a "צור שוכר חדש" button/link
there, matching C1's own "create user" pattern from the earlier phase).

Form fields, matching the original request exactly: tenant name, subdomain (with a debounced
availability check against a new `GET /platform-admin/tenants/check-subdomain?value=X` endpoint —
same UX principle as any signup-flow username-availability check), admin email, logo (native
`<input type="file" accept="image/png,image/jpeg">`), theme color (native `<input type="color">` —
this alone returns a `#rrggbb` string with zero custom color-picker code needed).

**Submit flow (two requests, matching how this codebase already separates entity-creation from
file upload elsewhere):**
1. `POST /platform-admin/tenants` (C1.2's extended endpoint) with the JSON fields (no logo file in
   this request — logos are binary, JSON can't carry them cleanly) → tenant created, admin
   created, temp password returned.
2. If a logo file was chosen, immediately follow with `POST /platform-admin/tenants/:id/logo`
   (multipart) using the `tenantId` from step 1's response.

**Success state:** show the created tenant's subdomain (for C2 to give this real meaning later;
until then, informational), the admin's email, and the one-time temp password — same
dismissible-banner pattern C1 (users, Phase B/prior work) already established, since there's still
no email-delivery step wired for *this* credential (Phase A wired password-reset email delivery,
not this).

### C1.6 — Testing (C1 only)

- Backend unit tests: subdomain regex/reserved-word validation, uniqueness-conflict → 409,
  the transaction's rollback-on-partial-failure behavior (mock a failing admin-create and assert
  the tenant doesn't persist), logo-upload magic-byte rejection of non-image files, size-cap
  rejection, signed-URL issuance appearing in `getSession()` only when `logoObjectKey` is set.
- Integration test extending the existing `mongodb-memory-server` harness — **first check whether
  it needs a replica-set flag for transaction support** (see C1.2 point 3); if the harness needs a
  config change to support this, that's still a C1 test-infra task, not a C2/production concern.
- Frontend: no new e2e test framework needed — extend `folders-groups.spec.ts`'s pattern with a
  new spec exercising the superuser form against `dev-server.ts` (needs the harness's seed script
  extended to expose a platform-admin login the way it already does for the tenant-admin one).

---

## C2 — Real per-tenant subdomain routing

Everything below is genuinely new production infrastructure, not application code — this is the
part that must not touch the live VM without a separate, explicit go-ahead, same as every other
production change this project has made.

### C2.1 — Subdomain scheme

`{subdomain}.app.{$DOMAIN}` (e.g. `acme.app.bahat.co.il`) — nests under the existing `app.`
namespace rather than competing with it at the root, so it can never collide with the reserved
`api.`/`admin.`/`app.` prefixes at the root level (`acme.app.bahat.co.il` vs `api.bahat.co.il` are
structurally distinct, no reservation logic needed at the DNS/Caddy layer beyond what C1.2 already
does at the application layer for the subdomain *value* itself).

The existing bare `app.{$DOMAIN}` (no tenant subdomain) stays as-is — the generic entry point for
tenants without a subdomain set (every tenant created before C1 ships, and any created without
choosing one).

### C2.2 — Wildcard TLS (the actual hard part)

Let's Encrypt cannot issue a wildcard cert (`*.app.{$DOMAIN}`) via HTTP-01 (the challenge type
Caddy uses automatically today) — wildcards require DNS-01, which requires proving control of the
DNS zone by creating a TXT record, which requires Caddy to have API write access to the DNS
provider.

- **DNS provider:** Cloudflare (already the DNS host for `bahat.co.il`, confirmed in this
  project's history — no new provider relationship needed).
- **Caddy build:** the stock `caddy:2-alpine` image (currently used, per `deploy/docker-compose.yml`)
  does **not** include the Cloudflare DNS module. Needs a custom Caddy build via `xcaddy`:
  ```
  xcaddy build --with github.com/caddy-dns/cloudflare
  ```
  New file `deploy/caddy.Dockerfile` (multi-stage: `xcaddy` build stage → minimal runtime stage,
  matching the shape of `apps/*/Dockerfile`'s existing multi-stage pattern).
  **Confirmed 2026-08-22: built on the VM directly**, not pushed from local — matching the
  existing arm64-build-on-VM fallback pattern already used for the app images, and avoiding adding
  `xcaddy` to the local build toolchain. This means `deploy/smoke-deploy.sh` (Phase A) does **not**
  gain a fourth image to build+push for Caddy; instead the VM-side deploy step needs its own
  `docker compose build caddy` (or equivalent) before `up -d`, which the script's SSH deploy stage
  must account for when C2 is implemented.
- **Credential:** a new Cloudflare API token, scoped to `Zone:DNS:Edit` for the `bahat.co.il` zone
  only (not a full-access token) — stored as `CF_API_TOKEN` in the VM's `.env`, referenced in the
  Caddyfile via `{env.CF_API_TOKEN}`, following the same env-var-substitution convention the
  Caddyfile already uses for `{$DOMAIN}`.
- **Caddyfile change:** a new site block:
  ```
  *.app.{$DOMAIN} {
      tls {
          dns cloudflare {env.CF_API_TOKEN}
      }
      import security_headers
      handle_path /api/* {
          reverse_proxy api:3000
      }
      handle {
          reverse_proxy web:3010
      }
  }
  ```
  Structurally identical to the existing `app.{$DOMAIN}` block (reuses the exact same-origin
  `/api/*` routing the 2026-08-21 retro fix established) — the only new thing is the `tls dns
  cloudflare` directive forcing DNS-01 for this block specifically.

### C2.3 — DNS records

Two records needed (a wildcard does **not** cover its own parent):
- Keep the existing `app.{$DOMAIN}` A record (already live).
- Add `*.app.{$DOMAIN}` — A record (or CNAME to `app.{$DOMAIN}`) pointing at the same VM IP.

One real operational upside worth noting: because this is a *wildcard* cert, **provisioning a new
tenant's subdomain (C1.2) needs zero new certificate work** — the wildcard already covers any
label under `*.app.{$DOMAIN}`, so a new tenant is reachable over valid TLS the instant its
`subdomain` field is set, with no per-tenant cert-issuance step.

### C2.4 — Hostname → tenant resolution

**Explicit safety invariant, stated up front because it's the thing most likely to get quietly
violated during implementation:** hostname-based tenant resolution is **additive only** — it never
becomes the source of truth for which tenant an authenticated session belongs to. That's still,
and remains, resolved from the logged-in user's email server-side (unchanged since Phase 0). A
user typing correct credentials on the *wrong* tenant's subdomain must still log into their *own*
tenant, not the one implied by the URL — hostname is a pre-login branding hint and a post-login
vanity URL, nothing else. Getting this backwards would be a real tenant-isolation bug, not a
cosmetic one.

What hostname resolution actually adds:
- A new public, unauthenticated endpoint: `GET /auth/branding` (apps/api, `@Public()`,
  `@EditionExempt()`, matching the existing pattern for pre-auth endpoints like
  `password-reset/request`). Resolves the tenant from the **incoming request's Host header**
  directly — verify during implementation that Caddy's `handle_path` preserves the original Host
  header through to the `api` container by default (it does, unless a `header_up Host` override is
  added — this needs confirming against the actual Caddy version in use, not assumed from general
  Caddy knowledge, before relying on it). Returns `{tenantName, logoUrl?, themeColorRgb?}` for a
  resolved subdomain, or a generic/empty response for the bare `app.{$DOMAIN}` host.
- `/login` (and `/login/totp`, `/password-reset*`) fetch this once on mount and apply it the same
  way `AppShell` applies post-login branding (C1.4's CSS-variable override) — the pre-login and
  post-login branding mechanisms end up sharing the same application logic, just fed by two
  different data sources (an unauthenticated Host-based lookup vs. the authenticated session).
- `TenantsRepository.findBySubdomain()` (already added in C1.2) is the only new repository method
  needed — no new middleware layer imposed on every request, since this only matters for the
  handful of explicitly pre-auth endpoints, not the authenticated ones (which keep resolving
  tenant from session exactly as today).

### C2.5 — Deployment sequencing (do not execute without separate approval)

1. Cloudflare API token created (owner-side action, like the original DNS setup).
2. `deploy/caddy.Dockerfile` built and verified **locally** (not on the VM) — confirm Caddy starts,
   loads the Cloudflare module, and the Caddyfile parses, before this ever reaches the VM.
3. New DNS record added (owner-side, like the original three A records).
4. VM `.env` gets `CF_API_TOKEN`.
5. Deploy the new Caddy image + Caddyfile via `deploy/smoke-deploy.sh` (Phase A's deploy gate) —
   extend that script to also verify the wildcard block specifically (e.g. curl a throwaway
   `test-subdomain.app.{$DOMAIN}` and confirm a valid cert chain, not just `/health` on the
   existing hostnames).
6. Only after that succeeds: C1's superuser screen becomes fully meaningful (subdomains resolve to
   real, TLS-valid, branded destinations) rather than just a stored, inert field.

### C2.6 — Testing (C2 only)

Real per-tenant subdomain behavior is **not fully testable locally** — `localhost` doesn't do
wildcard DNS, and issuing real Let's Encrypt DNS-01 certs from a local dev machine against the
real `bahat.co.il` zone for test purposes is not something to do casually (rate limits are real
and shared with the production domain). Plan:
- Unit-test the hostname-parsing/resolution logic in isolation (given a `Host` header string,
  resolve the expected subdomain) — no real DNS/TLS involved.
- Unit/integration-test `GET /auth/branding` against `mongodb-memory-server` with a fake Host
  header, same as every other integration spec in this codebase.
- The wildcard-cert-issuance and Caddy-routing pieces get **one real verification pass against the
  actual VM** post-deploy (per C2.5 step 5), not a repeatable local test — document this
  explicitly as the accepted verification method for this specific piece, rather than silently
  having weaker coverage than everything else in this codebase without saying so.

---

## Open questions — resolved 2026-08-22

1. **C1 vs. C1+C2 together** — **confirmed: C1 first**, C2 sequenced separately per the
   recommendation above. Do not build C2 in the same pass as C1.
2. **On-primary contrast computation** (C1.4) — **confirmed: build the dynamic luminance-based
   text-color** alongside `primary` (the `--color-on-primary-dynamic` approach), not the
   white-text-only shortcut.
3. **SVG logos** — **deferred, not decided now.** Proceed with the PNG/JPEG-only default from
   C1.3 for the initial build (avoids the inline-SVG XSS surface without blocking on a decision),
   but treat SVG support as an explicit open question to revisit later, not a closed "excluded"
   decision.
4. **Caddy build ownership** (C2.2) — **confirmed: build the custom Caddy image on the VM
   directly**, matching the existing arm64-build-on-VM fallback pattern already used for the app
   images. No new local `xcaddy` toolchain needed; `deploy/smoke-deploy.sh` (Phase A) and
   `deploy/caddy.Dockerfile`'s build step both need to account for Caddy being the one service
   built on-VM rather than pushed from local, when C2 implementation starts.
5. **Reserved-subdomain list** (C1.2) — not explicitly revisited; the proposed
   `api`/`admin`/`app`/`www`/`mail` list stands as the default. Flag again before implementation
   if anything else needs reserving.

---

## C1 — Implementation record (2026-08-22)

Built essentially as designed above, plus a few real decisions/findings made during
implementation, worth recording since they diverge from or add to the C1.1–C1.6 design:

- **New shared `libs/storage` package.** The design assumed portal-api would get "a" `StorageProvider`
  binding without specifying how; in practice, duplicating `StorageProvider`/`FakeStorageProvider`/
  `GcsStorageProvider`/`OciStorageProvider`/`S3StorageProvider` (~300 lines) into portal-api was
  clearly worse than promoting the whole thing (plus `magic-byte-sniff.ts`) out of `apps/api` into a
  new `libs/storage` package both apps depend on. `apps/api`'s own imports were repointed at
  `@kms/storage` with no behavior change.
- **Atomicity: compensating delete, not a real Mongo transaction.** The design flagged this as an
  open risk ("first check whether the harness needs a replica-set flag"). Resolution: don't use
  `session.withTransaction()` at all — `apps/api/test/support/test-app.ts`'s shared
  `mongodb-memory-server` harness boots standalone, not a replica set, and reconfiguring it (used by
  many other specs) was judged riskier than the alternative. `provision()` creates the tenant, then
  the admin, and deletes the tenant if admin-creation throws — same behavior in tests and against
  real Atlas, rather than two different code paths.
- **`ProvisionTenantRequestSchema`'s `.refine()` is the one and only reserved-word check** — both
  `provision()` and `check-subdomain` call the same schema field, so the list can't drift between
  the two endpoints the way two independent checks could.
- **Real bug found by live verification, fixed:** `StorageProvider.getSignedDownloadUrl()` was
  *always* forcing `Content-Disposition: attachment` + `Content-Type: application/octet-stream` —
  correct and deliberate for tenant *documents* (sec §4.4's XSS guard against untrusted uploads),
  but it defeats the purpose of a logo `<img>`, which is specifically meant to render inline, and
  which is already validated safe (magic-byte-sniffed to PNG/JPEG only at upload). Fixed by adding
  an opt-in `inline`/`contentType` pair to `getSignedDownloadUrl` (GCS/S3 honor it per-download at
  signing time; OCI can't — its PARs fix disposition at *upload* time, so `putObject` grew a
  matching `disposition` option instead) — default behavior for every existing document-download
  call site is unchanged. See `libs/storage/src/storage-provider.ts`'s interface doc comments for
  the full reasoning.
- **Real bug found by live verification, fixed:** `deploy/docker-compose.yml`'s `portal-api`
  service was missing `OCI_DATA_BUCKET`/`OCI_NAMESPACE`/`OCI_REGION` entirely (present on `api`,
  absent here) — meaning in the current production deploy, portal-api's `storageProviderProvider`
  factory would silently fall back to the in-process `FakeStorageProvider` for logo uploads. A logo
  would "upload" successfully from the superuser's point of view but never reach the real bucket
  `api` reads from, and every session load for that tenant would then fail to sign a URL for an
  object that was never actually written. Fixed by adding the same three env vars to `portal-api`'s
  block, with a comment explaining why they're needed there too.
- **Real robustness gap found by live verification, fixed:** `AuthController.getSession()` is the
  "whoami" every authenticated page load depends on; before the fix, any failure signing the logo
  URL (missing object, storage hiccup) threw and 500'd the *entire* session check, effectively
  locking every user in that tenant out of the app over what's cosmetically a logo. Now wrapped so
  a signing failure degrades to `logoUrl: undefined` (AppShell already had a sensible fallback: the
  generic "domain" icon) rather than breaking login.
- **Deliberately not built:** the reserved-subdomain list's `www`/`mail` entries have no real
  routing behind them yet (C2 isn't built) — they're forward-looking reservations, not currently
  load-bearing. SVG logo support remains the one genuinely open, deferred decision per item 3 above.

### Live verification (2026-08-22)

Full build/lint/unit/integration suite green (`pnpm turbo run build lint test:unit`, plus
`apps/api`'s integration suite run directly — 22/22, including the extended
`bootstrap.integration.spec.ts`). Beyond that, exercised the **real, complete flow live** in a
browser against a throwaway dual-process harness (both `apps/api` and `apps/portal-api` booted
together against one shared `mongodb-memory-server`, never committed to the repo): platform-admin
login → TOTP → superuser form (debounced subdomain-availability check confirmed live, showed
"זמין") → submit → tenant + admin atomically created, temp password shown once → uploaded a real
PNG through the multipart endpoint → logged in as the new tenant's admin (password + first-login
TOTP enrollment) → landed on `/home` with **zero console errors** → confirmed via
`getComputedStyle` that a light theme color (`#ffee00`) produced `--color-on-primary-dynamic:
#000000` (black text) rather than illegible white-on-yellow — the exact contrast bug C1.4 flagged
as a risk, confirmed actually prevented. This pass is also what surfaced the three fixes above.

**Known, accepted verification gap, not closable in this environment:** whether a *real* signed
`<img>` URL from GCS/S3/OCI with `Content-Disposition: inline` actually paints in a browser was
not, and could not be, verified here — this sandbox has no live cloud storage credentials for any
of the three providers (the same standing limitation recorded throughout this project's docs for
every other real-storage-backed feature). The dev-harness's `FakeStorageProvider` doesn't produce a
real fetchable URL scheme (`fake://storage/...`) either, so no environment available here can
close this gap; the fix is implemented on correct, standard Content-Disposition/Content-Type
semantics and unit-tested via `FakeStorageProvider`'s own disposition/contentType bookkeeping, but
the final "does it actually render" step is deferred to the first real deploy with a live bucket —
same as every other real-storage code path in this project.

### Review process note

Rule 4's code-quality pipeline was attempted via two parallel subagents (`code-reviewer`,
`security-reviewer`) dispatched against the full diff; both hung for over an hour with no output
and did not respond to a direct status-check message, so they were stopped and the review was
conducted directly instead (self-review + the live-verification pass above, which is what actually
found the three real issues fixed in this record).
