# Multi-Tenant RAG Knowledge Base (working dir: `crm`)

Multi-tenant knowledge management + AI chat over organizational documents for the Israeli market (Hebrew-first). **Not a classic CRM** despite the directory name.

## Project status

Architecture phase complete (ADRs 0001–0010 **Accepted**, 0008 gated on the Hebrew benchmark; design-quality review 2026-07-10 applied — see `docs/architecture/design-review-2026-07-10.md`). **Phase 0 and Phase 1 of `docs/plans/implementation-phases-11-07-2026-plan.md` are both complete** (all items 1.1–1.8 DONE; `pnpm turbo run build lint test:unit` all green across all 10 workspace packages). The full identity/auth spine is real and tested: tenants/users/platformAdmins collections, Argon2id + KMS-envelope-encrypted TOTP + backup codes, breach-list check, password reset, ToS gate, login hardening (progressive delay/lockout/CAPTCHA hook), the two-realm login→TOTP→session handshake (tenant + platform-admin, each with its own guard chain), tenant-admin user CRUD + CSV import, portal-api's tenant lifecycle CRUD + two-person MFA reset, and a working (if unstyled) Next.js UI for all of it including RTL and admin-hostname routing. ADR-0010 (schema migrations) is Accepted but its `migrations/` package is not yet built — that's Phase 2+ work, tracked as a Follow-up in the ADR itself.

**Phase 2A (Calendar & Task Management, parallel lane) backend is complete and merged to `main`** (2026-08-12, `docs/plans/phase-2a-calendar-kanban-04-08-2026-plan.md`'s 11-task SDD ledger): `events`/`tasks`/`userNotificationPreferences` collections, module-entitlement (ADR-0012, `tenants.featureToggles` + `@Module`/`ModuleGuard` parallel to `EditionGuard`), calendar/kanban controllers with group-membership authorization (tenant admins bypass, matching `DocumentsPermissionsService`'s precedent), always-on invite/assignment emails plus preference-gated file/task notifications (ADR-0013 picks the provider), and a real integration-test harness (`apps/api/test/`, `mongodb-memory-server` + `ioredis-mock` — no live Mongo/Redis or Docker needed) covering cross-tenant/non-member/module-disabled 404s through the full guard chain. **UI screens are not built — and are no longer part of v1.0**: the customer's requirement changed 2026-08-15, descoping calendar/kanban from their first release to a v1.1 follow-up. This needed zero code changes (the module is already opt-in per tenant, off by default — see ADR-0012); only a shaped UI spec (`docs/ui/calendar-kanban-notifications-addendum-v01.md`, screens F1–F4) exists, unbuilt, tracked as v1.1 scope.

**Phase 2 (Folders, permissions, file storage) is now fully complete and merged to `main`**, backend (2026-08-13, `docs/plans/phase-2-folder-group-management-12-08-2026-plan.md`) and UI+tests (2026-08-15, `docs/plans/phase-2-ui-folder-permissions-13-08-2026-plan.md`): `FoldersController` (list/tree with widening badges, detail with manage-tier-gated grants, create/rename/move/delete, grant/revoke/reset-to-inherited/set-public, "why can Dana see this" effective-permission preview) and `GroupsController` (create, list/detail with membership withheld below admin/member, membership add/remove, delete-when-unreferenced) sit behind the ADR-0005 resolution library and `PermissionCache`. `permVersion` is bumped + audited on every permission-relevant mutation (grants, group membership, folder create/move). Upload/serving/recycle-bin (2.3–2.5) were already done as a side effect of Phase 2A. UI: `/folders`, `/folders/[id]` (breadcrumb, subfolders, read-only documents), `/folders/[id]/permissions` (C3), `/groups`, `/groups/[id]` (C2). Tests: `apps/api/test/folders-permission-matrix.integration.spec.ts` (7 tests — inheritance/override/public/widening/permVersion-invalidation/cross-tenant/unauthenticated) plus a real Playwright golden-path pass (`apps/web/e2e/folders-groups.spec.ts`) against a seeded local dev harness (`apps/api/test/support/dev-server.ts`) — the first phase in this project verified against a *reachable* backend rather than an unreachable one. Drag-drop upload, OCR engine choice, quota-gate UX, and version history (UI spec B3–B5) remain deliberately out of scope, not yet planned.

**C1 (tenant-admin user management) was built 2026-08-21**, closing a gap the Phase 2 UI pass left
behind: `TenantUsersAdminController` (list/create/deactivate/reactivate/CSV-import) had no frontend
at all until now — `apps/web/app/users/page.tsx`, linked from `/home`'s admin nav. MFA reset stays
out of scope here (separate platform-admin two-person flow). Full status of every screen, built vs.
API-only vs. not-started, is tracked in `docs/ui/user-scenarios-v01.md`.

**Design-system adoption (Tailwind v4) and the superuser tenant-provisioning screen were both built
2026-08-22** (`docs/plans/master-gaps-design-superuser-22-08-2026-plan.md` Phases A–C1): `apps/web`
now runs on a CSS-variable-driven Tailwind token system (`apps/web/app/globals.css`) across every
screen, including a new `/admin/tenants/new` superuser form — `PlatformTenantsController.provision`
(apps/portal-api) atomically creates a tenant + its first admin, with logo upload and a per-tenant
theme color (dynamic-contrast on-primary text, not hardcoded white). Object storage is now a shared
`libs/storage` package (moved out of `apps/api`, since portal-api needed a binding too). Full
design/decision record — including two real bugs a live-verification pass found and fixed
(portal-api's deploy config was missing its OCI storage env vars; signed logo URLs were forcing
`Content-Disposition: attachment`, which would have kept them from rendering inline) — is in
`docs/plans/superuser-subdomain-provisioning-22-08-2026-plan.md`. **Real per-tenant subdomain
routing (that plan's C2) is deliberately NOT built** — new production infra (wildcard TLS, Caddy,
DNS), gated on separate explicit approval before starting.

**User management (C1) was substantially extended 2026-08-24**
(`docs/plans/user-management-invites-group-roles-24-08-2026-plan.md`): creating a user no longer
returns a one-time temp password — it emails a 24h single-use activation link
(`POST /auth/activate/check` + `POST /auth/activate/confirm`, new `/activate` screen), tracked via
a new `'pending'` user status plus `activatedAt`/`inviteTokenHash`/`inviteExpiresAt` fields.
`TenantUsersAdminController` gained `update` (edit email/name/role/groups) and `resend-invite`;
`/users/[id]` is a new edit screen. Groups gained a third dimension: `Group.members` moved from a
flat user-id array to `{userId, role: 'viewer'|'editor'|'manager'}[]` — ADR-0005's resolver now
caps whatever tier a folder grants a group by the member's own role (`GROUP_ROLE_TIER` in
`libs/permissions/src/resolve-permissions.ts`), surfaced in `/groups/[id]` and the shared
`GroupRolePicker` component. CSV import gained a `groups` column (`"Sales:editor;Legal:viewer"`).
A security-reviewer pass (Snyk unauthenticated in this sandbox, so a `security-reviewer` agent
substituted per Rule 4's fallback) found 14 issues; 5 real ones in this new code were fixed +
tested (a resolver fail-open on malformed tier data, a token-in-URL leak on `activate/check`,
incomplete token cleanup on deactivate, a `reactivate` bug that would have broken every
pre-existing account including seeded admins, missing input validation on the controller) — full
disposition of all 14 in the plan doc. Also fixed in passing (pre-existing, unrelated to this
work, found by the same review): a live hardcoded TOTP seed and a stray `.bak` file removed from
the repo (`*.bak` now gitignored), `multer` bumped off its vulnerable 1.x pin in both `apps/api`
and `apps/portal-api`.

**A full RAG chat feature (Phase 3 ingestion + Phase 4 chat, unpaused together) was built 2026-08-28**
at explicit user request (`docs/plans/document-chat-rag-28-08-2026-plan.md`; the master phase plan's
own item-by-item status now lives there instead of a summary here). Real ingestion pipeline:
`apps/worker` went from a pool-selection stub to a real BullMQ `Worker`/`Queue` consumer (`scan →
parse → chunk → embed → index`), with real PDF (`pdf-parse`)/DOCX (`mammoth`) text extraction, a
deterministic Hebrew-aware chunker, and a real `chunks` collection — verified via `apps/worker`'s own
integration suite (`mongodb-memory-server`) and a live real-Redis/real-BullMQ smoke run. Real
permission-scoped retrieval: `libs/retrieval` (new) implements ADR-0005's `permittedRead` pre-filter
with a fail-closed short-circuit (empty permission set ⇒ zero calls) plus a semantic-relevance floor
(`MIN_RELEVANCE_SCORE`) found necessary live — a permitted-but-irrelevant question was still
"answering" from an unrelated chunk before this. Real streaming chat: `apps/api/src/chat` (SSE,
server-side-only citation construction, rate limit + tenant budget) and `/chat` + `/chat/[id]` in
`apps/web`, live-verified end to end (login → ask → grounded cited answer → not-found for an
unrelated question → citation click re-verifies permission → delete). Everything runs against
Fake providers by default (`libs/ai-providers` gained `FakeChatProvider`/`FakeEmbeddingProvider` and
real-but-unverified `Vertex`/`Claude` bindings) — **the ADR-0008 Hebrew benchmark gate has not run**
(no eval corpus exists), so the real provider commitment stays open, same as before this work. Two
real, pre-existing gaps were also found and fixed along the way: `SessionAuthGuard` never populated
`Scope.ownerUserId`, so `OwnerScopedRepository` (conversations/messages' only access path) would have
thrown on every real request; and `ScopedRepository.aggregate()`'s `$match`-first assumption doesn't
hold for Atlas Vector Search, which needed `backstop.plugin.ts`'s tripwire extended to recognize
`$vectorSearch`/`$search`-embedded tenant filters too.

**Not yet verified against a live/production backend** — this environment has no real MongoDB Atlas connection, so nothing has been exercised against production-shaped data; testing so far is unit/component-level plus the Phase 2A/2/chat integration suites (real Mongoose queries against a real but ephemeral in-process `mongod`, not Atlas) and the Playwright passes above (also against the ephemeral local harness, not Atlas). Atlas Vector Search specifically is unverified against any real cluster — M0-tier support for it is itself unconfirmed.

## Monorepo (pnpm + Turborepo, ADR-0009)

```
apps/{api,portal-api,worker,web}   libs/{data,auth,permissions,ai-providers,contracts,config,storage,parsing,retrieval}
infra/ (ACTIVE Terraform — ADR-0015, OCI Always Free single VM)
infra-oci-managed/ (ADR-0014 managed topology — scale-up target, NOT active, ~$240/mo)
infra-gcp-superseded/ (old GCP Terraform, kept for reference)
deploy/ (docker-compose + Caddyfile — what actually runs on the VM)
test/{cross-tenant,evals}
```

**Hosting: OCI, two topologies — know which one you're looking at.** Moved off GCP 2026-08-15 ([ADR-0014](docs/adr/0014-hosting-topology-oci.md), supersedes ADR-0007) on cost grounds. Then, before anything was ever applied, a pre-apply cost review found ADR-0014's own free-tier claim was false — Container Instances, OCI Cache, and WAF are **not** Always Free at any size, making that topology **~$240/mo at zero users**. [ADR-0015](docs/adr/0015-pre-revenue-single-vm-topology.md) (2026-08-16) therefore **retargets** ADR-0014 as the *scale-up* topology and makes the *starting* one a single Always Free Ampere A1 VM (2 OCPU/12 GB, **arm64**) running `deploy/docker-compose.yml` behind Caddy. ADR-0014's Terraform is preserved intact at `infra-oci-managed/` (plan-verified, 52 resources) — it is not wrong, just not what you run at zero users. Two things the free topology does *better*, not just cheaper: real hostname routing (`api.`/`admin.`/`app.<domain>` via Caddy — ADR-0014's LB could only do per-port listeners) and the ADR-0007 Redis eviction-policy split actually working (managed OCI Cache couldn't express it). `apps/api`'s `StorageProvider` gained an `OciStorageProvider` binding alongside `Fake`/`Gcs`/`S3`, selected via `OCI_DATA_BUCKET`/`OCI_NAMESPACE`/`OCI_REGION`.

**`infra/` is APPLIED and live** (2026-08-19), in **`il-jerusalem-1`** — not `eu-frankfurt-1` as originally designed. That first region choice turned out to be wrong: the tenancy's actual home region (where Always Free applies) is Jerusalem, discovered mid-apply when an IAM policy failed with "go to your home region MTZ." Everything briefly created in Frankfurt was destroyed same-day before material charges accrued; see ADR-0015's correction section for the full story, the cost comparison (Frankfurt ~$30/mo vs. Hetzner ~$9–18/mo vs. Jerusalem $0/mo + best latency for an all-Israel user base) and two more real bugs the actual apply surfaced (`~/.oci/config`'s `region=` line silently overrides `terraform.tfvars`'s; `retention_rules.duration.time_unit` only accepts `YEARS`/`DAYS`, not `MONTHS`). Live: 1 VM (`public_ip` — `terraform output public_ip`), VCN+subnet+NSG, 2 buckets, 1 Vault + 2 keys + 5 secrets (argon2 pepper rotated to a real value; 4 LLM-provider-key secrets still placeholder, unneeded until Phase 4).

**`deploy/docker-compose.yml` is deployed and running on the VM** (2026-08-19) — `api`/`portal-api`/`web`/`caddy`/`redis-app`/`redis-queue` all up, `api`'s `/health` returns real `200` through a genuine MongoDB Atlas M0 connection. This was the **first real production boot** of the API and it surfaced a real, previously-latent bug: `assertEditionCoverage` (ADR-0009 G2) failed at startup because `FoldersController`/`GroupsController`/`EventsController`/`TasksController`/`CalendarController`/`NotificationPreferencesController` were missing `@Edition('kb')` — added when built but never caught, since no unit test exercises real app bootstrap. Fixed (all six now decorated), verified (254/254 unit tests green), redeployed. Also found: Oracle Linux 9 has no `docker`/`docker-compose-plugin` packages in its default repos at all (fixed in `modules/compute/main.tf` — Docker's own CentOS-compatible repo now added first) and this Mac's Docker Desktop `docker push` is broken against OCIR's `il-jerusalem-1` endpoint specifically (OCIR's auth layer verified entirely correct via raw HTTP; client-side bug, worked around with `crane push`). Full writeup in ADR-0015's "Deployed to the VM" section. Only remaining gap: DNS (`api.`/`admin.`/`app.bahat.co.il` → `84.13.85.78`) — owner-side, needed before Caddy can get real TLS certs.

Dev ports (no shared default — this bit us once): `apps/api` 3000, `apps/portal-api` 3100, `apps/web` 3010 (`next dev -p 3010` — Next's own default of 3000 collides with `apps/api`).

Commands: `pnpm install`, `pnpm turbo run build`, `pnpm turbo run lint`, `pnpm turbo run test:unit`, `pnpm turbo run test:integration`, `pnpm test:cross-tenant`. `apps/worker` selects its pool via `WORKER_POOL=parse|ai|index` env. `apps/api`/`apps/portal-api` each have a `pnpm run seed` (needs `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`/`PASSWORD_PEPPER`, and `apps/api`'s also needs `SEED_TENANT_NAME`) to create the first account — idempotent on email, requires a live MongoDB. Guard rules live in `eslint.config.mjs` + `eslint-rules/` (mongoose/`InjectModel` confined to `libs/data`; `SystemScope` import confined to `platform-admin/**`/`jobs/**`) — both are smoke-tested, not just configured. `infra/README.md` lists what a real `terraform apply` needs (OCI tenancy/compartment, Object Storage namespace, domain) — `infra/` is now applied for real (see above); `~/.oci/config`'s `region` must match `terraform.tfvars`'s (the provider follows the config file's region over the Terraform var for at least some calls — a real gotcha found the hard way).

**Testing infra:** `apps/api/test:integration` runs against `mongodb-memory-server` + `ioredis-mock` (real in-process Mongo, fake Redis) — no live MongoDB/Redis/Docker needed. `apps/api/test/support/dev-server.ts` (`pnpm --filter @kms/api exec ts-node --transpile-only test/support/dev-server.ts`) boots a real seeded API instance on the same harness for manual/browser testing — listens on **port 4000**, not 3000 (changed 2026-08-21, this dev machine runs an unrelated process on :3000; override with `DEV_HARNESS_PORT`), so point `apps/web` at it with `NEXT_PUBLIC_API_URL=http://localhost:4000`; `apps/web/e2e/` holds Playwright specs (`pnpm --filter @kms/web test:e2e`) that drive it end-to-end. The seeded admin's TOTP secret is now a fixed default (`ERVVGRZMM5NWYM2O`, override via `SEED_TOTP_SECRET`), not random per boot (2026-08-24 fix) — that's what let `folders-groups.spec.ts`'s hardcoded secret keep matching a freshly-booted harness instead of only the one seed run it was originally written against. Note: `apps/web`'s `lint`/`test:unit` scripts scope to the whole package dir (`.`), not `src` like every other app (no `src/` under Next.js App Router) — new root-level config files there land in both by default; `jest.config.js`'s `testPathIgnorePatterns` and `eslint.config.mjs`'s per-file overrides are how `e2e/` and CJS config files stay excluded.

## Documents (read in this order)

| File | What it is |
|---|---|
| `docs/requirements_v02.md` | **Authoritative PRD** — two editions (Knowledge Base + standalone Smart OCR), 16 sections. Supersedes `requirements_v01.md` (root, historical). |
| `docs/requirements_review_v01.md` | Review of v01 + **resolution log of owner decisions** (2026-07-07) — check before reopening any settled decision |
| `docs/security_requirements_v01.md` | Security spec — threat model, tenant-isolation architecture, LLM/RAG threats, Israeli 2017-regs obligations, MVP acceptance checklist |
| `docs/adr/` | **Accepted ADRs 0001–0014** (0007 superseded by 0014): tenant scoping, Atlas data/index design, ingestion pipeline (ClamAV in-VPC), auth/sessions (Redis, separate portal realm), RBAC resolution (cached on-read), object storage/signed-URL layout (0006, cloud-agnostic decisions, rebound to OCI primitives by 0014), ~~GCP Cloud Run topology~~ superseded, Vertex AI providers (gated on Hebrew benchmark), pnpm/Turborepo monorepo + edition gating, schema migrations & backfills, module entitlement, email provider, **OCI hosting topology (0014, current)** |
| `docs/architecture/system-overview.md` | Container + data-flow Mermaid diagrams, sec-§12 traceability table, future-ADR list (FINAL for the ADR pass) |
| `docs/architecture/design-review-2026-07-10.md` | Design-quality review record — 12 findings + dispositions (1/2/8 fixed in ADRs, 9 planned as ADR-0010, rest recorded with triggers) |
| `docs/test_plan_v01.md` | Test plan — security tests, LLM eval plan (datasets/thresholds), upgrade & maintenance process |
| `docs/security_audit_plan_v01.md` | Audit program — CI gates (Snyk/gitleaks), AI-assisted review, quarterly deep audits, pentest/SOC 2 cadence |
| `docs/ui/screens_spec_v01.md` | Screen inventory (P0/P1/P2), roles, states, RTL/security constraints; mockups artifact linked from session notes |
| `docs/analytics/posthog_analytics_v01.md` | PostHog proposal — EU cloud, event taxonomy (no content/query text), dashboards, tenant-group flags |
| `docs/pricing_model_v01.md` | Pricing proposal (DRAFT — price points are placeholders pending WTP validation) |

## Key settled decisions

- **Stack:** NestJS + Mongoose + MongoDB Atlas (Vector Search + Atlas Search) + Next.js; BullMQ/Redis workers for ingestion/OCR
- **Hebrew-first**, bilingual UI (RTL default); managed LLM/embedding APIs under zero-retention DPA; EU data residency (Israel region NOT required)
- **OCR:** user-selectable Classic (Google Vision/Azure — AWS Textract lacks Hebrew) or Advanced (vision LLM, token-metered); admin can enforce Classic-only
- **Compliance targets:** SOC 2 Type II, Israeli PPL, Israeli Data Security Regulations 2017
- **Security invariants:** tenantId injected at repository layer (never from request input); cross-tenant test suite on every PR; httpOnly-cookie sessions (no JWT in localStorage); files served only via short-lived signed URLs; chat markdown renderer blocks remote loads

## Next steps

1. **v1.0's own release scope is still the file hierarchy alone** (2026-08-15) — the 2026-08-28 chat work is additive, shipped behind ADR-0012's opt-in `'llm'` module flag (off by default), not a change to what v1.0 itself ships. Calendar/kanban UI (Phase 2A.3) is similarly still v1.1 scope.
2. **Eval-corpus lane E1 (Hebrew golden datasets) is the real remaining blocker on finalizing the LLM provider choice** — it was explicitly cut from the 2026-08-28 chat work (no code dependency, would have blocked shipping chat indefinitely). Until E1 exists and the ADR-0008 benchmark gate runs, chat stays on Fake providers with no real semantic quality — see `docs/plans/document-chat-rag-28-08-2026-plan.md`'s own mapping table for exactly what else that pass narrowed (real clamd, OCR, the failure-taxonomy/breaker, the processing-queue UI).
3. Given (1), the B3–B5 UI slice (drag-drop upload, OCR engine choice, quota-gate UX, document version history, processing queue) is still on hold, along with a standalone search screen (PRD's B7) and admin-configurable chat budgets — none were part of the 2026-08-28 pass either.
4. **`infra/` is applied and `deploy/docker-compose.yml` is running live on the VM** (2026-08-19, `il-jerusalem-1`, $0/mo) — see above. Only remaining gap: **DNS** — point `kiboapi.`/`kiboadmin.`/`kibo.bahat.co.il` at `84.13.85.78` (owner-side, as **DNS-only / not proxied** — Caddy's own Let's Encrypt HTTP challenge must reach the VM directly, so a proxying CDN in front of these three names breaks cert issuance); Caddy needs this to get real Let's Encrypt certs (HTTP routing already confirmed working via `Host:` header testing, just no valid TLS yet). Product name is **Kibo** (2026-08-30) — none of the three tenant/admin/API hostnames use the plain `app.`/`api.`/`admin.` names because all three were already taken on this domain; the tenant UI is `kibo.`, the API is `kiboapi.`, the platform-admin realm is `kiboadmin.` (also updated in `apps/web/middleware.ts`'s hostname check) — see `deploy/Caddyfile`'s and `deploy/README.md`'s own notes. The 4 LLM-provider-key Vault secrets are still placeholders — needed now if real chat providers are to be tried against production.
5. WTP interviews + real Hebrew-document token measurements before finalizing pricing (business lane, unblocked)
6. Phase 0/1/2 code has now run against a live Atlas cluster for the first time (2026-08-19, via the VM deploy above) — worth a closer look at real query behavior/perf now that this is possible, not just in-memory-Mongo suites. Atlas Vector Search itself (needed for real chat retrieval) has never been exercised against that cluster — confirm M0-tier support before assuming it'll just work.
7. ADR-0014 left one open question, not blocking today: whether Vertex AI's data-residency guarantee (EU/NA/Asia only) is affected by being called from OCI-hosted compute instead of GCP — revisit before real (non-Fake) chat providers go live, not before.
