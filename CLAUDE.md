# Multi-Tenant RAG Knowledge Base (working dir: `crm`)

Multi-tenant knowledge management + AI chat over organizational documents for the Israeli market (Hebrew-first). **Not a classic CRM** despite the directory name.

## Project status

Architecture phase complete (ADRs 0001–0010 **Accepted**, 0008 gated on the Hebrew benchmark; design-quality review 2026-07-10 applied — see `docs/architecture/design-review-2026-07-10.md`). **Phase 0 and Phase 1 of `docs/plans/implementation-phases-11-07-2026-plan.md` are both complete** (all items 1.1–1.8 DONE; `pnpm turbo run build lint test:unit` all green across all 10 workspace packages). The full identity/auth spine is real and tested: tenants/users/platformAdmins collections, Argon2id + KMS-envelope-encrypted TOTP + backup codes, breach-list check, password reset, ToS gate, login hardening (progressive delay/lockout/CAPTCHA hook), the two-realm login→TOTP→session handshake (tenant + platform-admin, each with its own guard chain), tenant-admin user CRUD + CSV import, portal-api's tenant lifecycle CRUD + two-person MFA reset, and a working (if unstyled) Next.js UI for all of it including RTL and admin-hostname routing. ADR-0010 (schema migrations) is Accepted but its `migrations/` package is not yet built — that's Phase 2+ work, tracked as a Follow-up in the ADR itself.

**Phase 2A (Calendar & Task Management, parallel lane) backend is complete and merged to `main`** (2026-08-12, `docs/plans/phase-2a-calendar-kanban-04-08-2026-plan.md`'s 11-task SDD ledger): `events`/`tasks`/`userNotificationPreferences` collections, module-entitlement (ADR-0012, `tenants.featureToggles` + `@Module`/`ModuleGuard` parallel to `EditionGuard`), calendar/kanban controllers with group-membership authorization (tenant admins bypass, matching `DocumentsPermissionsService`'s precedent), always-on invite/assignment emails plus preference-gated file/task notifications (ADR-0013 picks the provider), and a real integration-test harness (`apps/api/test/`, `mongodb-memory-server` + `ioredis-mock` — no live Mongo/Redis or Docker needed) covering cross-tenant/non-member/module-disabled 404s through the full guard chain. **UI screens are not built — and are no longer part of v1.0**: the customer's requirement changed 2026-08-15, descoping calendar/kanban from their first release to a v1.1 follow-up. This needed zero code changes (the module is already opt-in per tenant, off by default — see ADR-0012); only a shaped UI spec (`docs/ui/calendar-kanban-notifications-addendum-v01.md`, screens F1–F4) exists, unbuilt, tracked as v1.1 scope.

**Phase 2 (Folders, permissions, file storage) is now fully complete and merged to `main`**, backend (2026-08-13, `docs/plans/phase-2-folder-group-management-12-08-2026-plan.md`) and UI+tests (2026-08-15, `docs/plans/phase-2-ui-folder-permissions-13-08-2026-plan.md`): `FoldersController` (list/tree with widening badges, detail with manage-tier-gated grants, create/rename/move/delete, grant/revoke/reset-to-inherited/set-public, "why can Dana see this" effective-permission preview) and `GroupsController` (create, list/detail with membership withheld below admin/member, membership add/remove, delete-when-unreferenced) sit behind the ADR-0005 resolution library and `PermissionCache`. `permVersion` is bumped + audited on every permission-relevant mutation (grants, group membership, folder create/move). Upload/serving/recycle-bin (2.3–2.5) were already done as a side effect of Phase 2A. UI: `/folders`, `/folders/[id]` (breadcrumb, subfolders, read-only documents), `/folders/[id]/permissions` (C3), `/groups`, `/groups/[id]` (C2). Tests: `apps/api/test/folders-permission-matrix.integration.spec.ts` (7 tests — inheritance/override/public/widening/permVersion-invalidation/cross-tenant/unauthenticated) plus a real Playwright golden-path pass (`apps/web/e2e/folders-groups.spec.ts`) against a seeded local dev harness (`apps/api/test/support/dev-server.ts`) — the first phase in this project verified against a *reachable* backend rather than an unreachable one. Drag-drop upload, OCR engine choice, quota-gate UX, and version history (UI spec B3–B5) remain deliberately out of scope, not yet planned.

**Not yet verified against a live/production backend** — this environment has no real MongoDB Atlas connection, so nothing has been exercised against production-shaped data; testing so far is unit/component-level plus the Phase 2A/2 integration suites (real Mongoose queries against a real but ephemeral in-process `mongod`, not Atlas) and the Playwright pass above (also against the ephemeral local harness, not Atlas).

## Monorepo (pnpm + Turborepo, ADR-0009)

```
apps/{api,portal-api,worker,web}   libs/{data,auth,permissions,ai-providers,contracts,config}
infra/ (Terraform, OCI — ADR-0014)   infra-gcp-superseded/ (old GCP Terraform, kept for reference)
test/{cross-tenant,evals}
```

**Hosting moved from GCP to OCI 2026-08-15** ([ADR-0014](docs/adr/0014-hosting-topology-oci.md), supersedes ADR-0007) — mainly cost: this app's two heaviest cost centers (2 Redis instances, egress-heavy signed-URL file serving) are meaningfully cheaper on OCI at real volume, not just free-tier. `infra/` is now OCI Terraform (network/cache/object-storage/vault/compute modules); the original GCP modules are preserved at `infra-gcp-superseded/`, not deleted. `apps/api`'s `StorageProvider` interface (`documents/storage/storage-provider.ts`) gained a fourth binding, `OciStorageProvider`, alongside `Fake`/`Gcs` — selected via `OCI_DATA_BUCKET`/`OCI_NAMESPACE`/`OCI_REGION` env vars, zero behavior change when unset. `terraform validate`+`plan` have been run against a real OCI tenancy (52 resources, 0 errors) — `terraform apply` has not, so nothing is actually provisioned/billed yet.

Dev ports (no shared default — this bit us once): `apps/api` 3000, `apps/portal-api` 3100, `apps/web` 3010 (`next dev -p 3010` — Next's own default of 3000 collides with `apps/api`).

Commands: `pnpm install`, `pnpm turbo run build`, `pnpm turbo run lint`, `pnpm turbo run test:unit`, `pnpm turbo run test:integration`, `pnpm test:cross-tenant`. `apps/worker` selects its pool via `WORKER_POOL=parse|ai|index` env. `apps/api`/`apps/portal-api` each have a `pnpm run seed` (needs `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`/`PASSWORD_PEPPER`, and `apps/api`'s also needs `SEED_TENANT_NAME`) to create the first account — idempotent on email, requires a live MongoDB. Guard rules live in `eslint.config.mjs` + `eslint-rules/` (mongoose/`InjectModel` confined to `libs/data`; `SystemScope` import confined to `platform-admin/**`/`jobs/**`) — both are smoke-tested, not just configured. `infra/README.md` lists what a real `terraform apply` needs (OCI tenancy/compartment, Object Storage namespace, domain) — an OCI tenancy now exists (compartment provisioned, `oci setup config` done) and `terraform plan` has been run against it clean, but `apply` itself hasn't, by deliberate choice (cost-incurring, needs explicit go-ahead separate from getting the plan clean).

**Testing infra:** `apps/api/test:integration` runs against `mongodb-memory-server` + `ioredis-mock` (real in-process Mongo, fake Redis) — no live MongoDB/Redis/Docker needed. `apps/api/test/support/dev-server.ts` (`pnpm --filter @kms/api exec ts-node --transpile-only test/support/dev-server.ts`) boots a real seeded API instance on the same harness for manual/browser testing; `apps/web/e2e/` holds Playwright specs (`pnpm --filter @kms/web test:e2e`) that drive it end-to-end. Note: `apps/web`'s `lint`/`test:unit` scripts scope to the whole package dir (`.`), not `src` like every other app (no `src/` under Next.js App Router) — new root-level config files there land in both by default; `jest.config.js`'s `testPathIgnorePatterns` and `eslint.config.mjs`'s per-file overrides are how `e2e/` and CJS config files stay excluded.

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

1. **v1.0 scope is now the file hierarchy alone** (2026-08-15): auth + folders/permissions/groups/upload/download, nothing that needs document processing. Phase 3 (ingestion/OCR) is explicitly deferred — do not start it without being asked. Calendar/kanban UI (Phase 2A.3) is similarly v1.1 scope, not v1.0 — descoped 2026-08-15.
2. Given (1), the B3–B5 UI slice (drag-drop upload, OCR engine choice, quota-gate UX, document version history, processing queue) is also on hold — most of it assumes Phase 3 exists. Revisit v1.0's remaining UI gaps once this scope is confirmed to still hold.
3. **`terraform apply` against the real OCI tenancy is the next infra step**, whenever it's explicitly requested — `plan` is clean (52 resources, 0 errors) but nothing has actually been provisioned yet. Applying also unblocks validating ADR-0010's migration-runner journal/locking behavior against a live Atlas cluster (deferred, see the ADR's Status section).
4. Eval-corpus lane E1 (Hebrew golden datasets) can start in parallel — it blocks the ADR-0008 gate inside Phase 4
5. WTP interviews + real Hebrew-document token measurements before finalizing pricing (business lane, unblocked)
6. Phase 0/1/2 code has still never run against a live Atlas cluster (only in-memory-Mongo integration suites have exercised real Mongoose queries) — first real live-Atlas run should happen once infra is actually applied
7. ADR-0014 left one open question, not blocking today: whether Vertex AI's data-residency guarantee (EU/NA/Asia only) is affected by being called from OCI-hosted compute instead of GCP — revisit before Phase 4 (chat) is built, not before
