# Multi-Tenant RAG Knowledge Base (working dir: `crm`)

Multi-tenant knowledge management + AI chat over organizational documents for the Israeli market (Hebrew-first). **Not a classic CRM** despite the directory name.

## Project status

Architecture phase complete (ADRs 0001–0010 **Accepted**, 0008 gated on the Hebrew benchmark; design-quality review 2026-07-10 applied — see `docs/architecture/design-review-2026-07-10.md`). **Phase 0 and Phase 1 of `docs/plans/implementation-phases-11-07-2026-plan.md` are both complete** (all items 1.1–1.8 DONE; `pnpm turbo run build lint test:unit` all green across all 10 workspace packages). The full identity/auth spine is real and tested: tenants/users/platformAdmins collections, Argon2id + KMS-envelope-encrypted TOTP + backup codes, breach-list check, password reset, ToS gate, login hardening (progressive delay/lockout/CAPTCHA hook), the two-realm login→TOTP→session handshake (tenant + platform-admin, each with its own guard chain), tenant-admin user CRUD + CSV import, portal-api's tenant lifecycle CRUD + two-person MFA reset, and a working (if unstyled) Next.js UI for all of it including RTL and admin-hostname routing. ADR-0010 (schema migrations) is Accepted but its `migrations/` package is not yet built — that's Phase 2+ work, tracked as a Follow-up in the ADR itself.

**Phase 2A (Calendar & Task Management, parallel lane) backend is complete and merged to `main`** (2026-08-12, `docs/plans/phase-2a-calendar-kanban-04-08-2026-plan.md`'s 11-task SDD ledger): `events`/`tasks`/`userNotificationPreferences` collections, module-entitlement (ADR-0012, `@Module`/`ModuleGuard` parallel to `EditionGuard`), calendar/kanban controllers with group-membership authorization (tenant admins bypass, matching `DocumentsPermissionsService`'s precedent), always-on invite/assignment emails plus preference-gated file/task notifications (ADR-0013 picks the provider), and a real integration-test harness (`apps/api/test/`, `mongodb-memory-server` + `ioredis-mock` — no live Mongo/Redis or Docker needed) covering cross-tenant/non-member/module-disabled 404s through the full guard chain. **UI screens are not built** — only a shaped spec (`docs/ui/calendar-kanban-notifications-addendum-v01.md`, screens F1–F4) exists.

**Phase 2 (Folders, permissions, file storage) backend is now fully complete and merged to `main`** (2026-08-13, `docs/plans/phase-2-folder-group-management-12-08-2026-plan.md`'s 7-task SDD ledger): `FoldersController` (list/tree with widening badges, detail with manage-tier-gated grants, create/rename/move/delete, grant/revoke/reset-to-inherited/set-public, "why can Dana see this" effective-permission preview) and `GroupsController` (create, list/detail with membership withheld below admin/member, membership add/remove, delete-when-unreferenced) now sit behind the ADR-0005 resolution library and `PermissionCache`, which Phase 2A had already built but left unreachable from any route. `permVersion` is bumped + audited on every permission-relevant mutation (grants, group membership, folder create/move). Upload/serving/recycle-bin (2.3–2.5) were already done as a side effect of Phase 2A. **UI (2.6) and the permission-matrix/cross-tenant integration test suite (2.7) are not built** — deliberately deferred to a follow-on plan.

**Not yet verified against a live/production backend** — this environment has no real MongoDB Atlas connection, so nothing has been exercised against production-shaped data; testing so far is unit/component-level plus the Phase 2A integration suite (real Mongoose queries against a real but ephemeral in-process `mongod`, not Atlas) and one Playwright pass against an unreachable API.

## Monorepo (pnpm + Turborepo, ADR-0009)

```
apps/{api,portal-api,worker,web}   libs/{data,auth,permissions,ai-providers,contracts,config}
infra/ (Terraform, not yet applied)   test/{cross-tenant,evals}
```

Dev ports (no shared default — this bit us once): `apps/api` 3000, `apps/portal-api` 3100, `apps/web` 3010 (`next dev -p 3010` — Next's own default of 3000 collides with `apps/api`).

Commands: `pnpm install`, `pnpm turbo run build`, `pnpm turbo run lint`, `pnpm turbo run test:unit`, `pnpm test:cross-tenant`. `apps/worker` selects its pool via `WORKER_POOL=parse|ai|index` env. `apps/api`/`apps/portal-api` each have a `pnpm run seed` (needs `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`/`PASSWORD_PEPPER`, and `apps/api`'s also needs `SEED_TENANT_NAME`) to create the first account — idempotent on email, requires a live MongoDB. Guard rules live in `eslint.config.mjs` + `eslint-rules/` (mongoose/`InjectModel` confined to `libs/data`; `SystemScope` import confined to `platform-admin/**`/`jobs/**`) — both are smoke-tested, not just configured. `infra/README.md` lists what a real `terraform apply` needs (GCP project id, billing account, domain).

## Documents (read in this order)

| File | What it is |
|---|---|
| `docs/requirements_v02.md` | **Authoritative PRD** — two editions (Knowledge Base + standalone Smart OCR), 16 sections. Supersedes `requirements_v01.md` (root, historical). |
| `docs/requirements_review_v01.md` | Review of v01 + **resolution log of owner decisions** (2026-07-07) — check before reopening any settled decision |
| `docs/security_requirements_v01.md` | Security spec — threat model, tenant-isolation architecture, LLM/RAG threats, Israeli 2017-regs obligations, MVP acceptance checklist |
| `docs/adr/` | **Accepted ADRs 0001–0010**: tenant scoping, Atlas data/index design, ingestion pipeline (ClamAV in-VPC), auth/sessions (Redis, separate portal realm), RBAC resolution (cached on-read), GCS storage/signed URLs, GCP Cloud Run topology, Vertex AI providers (gated on Hebrew benchmark), pnpm/Turborepo monorepo + edition gating, schema migrations & backfills (custom NestJS runner, expand→backfill→contract, roll-forward-only) |
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

1. Phase 2 UI (folder tree, permission management, group screens — 2.6) and its permission-matrix/cross-tenant integration test suite (2.7) are the main sequential-lane gap now that Phase 2's backend is done; no follow-on plan has been written yet.
2. Phase 2A's UI screens (calendar/kanban board/notification-preferences — spec ready at `docs/ui/calendar-kanban-notifications-addendum-v01.md`) are still unbuilt; can be picked up independently of Phase 2's UI whenever there's UI bandwidth.
3. Provision a real GCP project + billing account so the Terraform skeleton (`infra/`) can actually apply — this also unblocks validating ADR-0010's migration-runner journal/locking behavior against a live Atlas cluster (deferred, see the ADR's Status section)
4. Eval-corpus lane E1 (Hebrew golden datasets) can start in parallel — it blocks the ADR-0008 gate inside Phase 4
5. WTP interviews + real Hebrew-document token measurements before finalizing pricing (business lane, unblocked)
6. Phase 0/1/2 code has still never run against a live Atlas cluster (only Phase 2A's in-memory-Mongo integration suite has exercised real Mongoose queries) — first real live-Atlas run should happen as soon as infra exists
