# Phased Implementation Plan — Multi-Tenant RAG Knowledge Base

**Date:** 2026-07-11 · **Status:** IN PROGRESS — Phase 0 complete; Phase 1 core spine (1.2 partial, 1.4) complete and verified
**Sources:** ADRs 0001–0009 (all Accepted; 0008 gated), `docs/architecture/system-overview.md`, `docs/architecture/design-review-2026-07-10.md`, `docs/test_plan_v01.md`, `docs/security_audit_plan_v01.md`, `docs/ui/screens_spec_v01.md`, PRD `docs/requirements_v02.md`
**Prime directive (ADR-0009 + working rule 3):** guards before features — the monorepo, lint rules, backstop plugin, CI gates, and cross-tenant test harness exist **before** the first feature endpoint. Every phase ships its tests inside the phase, not after.

## Phase map and dependencies

```text
P0 Foundation ─→ P1 Identity/Tenancy ─→ P2 Folders/Files ─→ P3 Ingestion ─→ P4 Retrieval/Chat ─→ P5 OCR-E/Portal ─→ P6 Hardening/Launch
                      │                                                        ▲
                      └── E1 Hebrew eval corpora (parallel lane) ──────────────┘  (E1 blocks the ADR-0008 gate inside P4)
ADR-0010 (schema migrations): written during P1; must be Accepted before the first production deploy.
```

Each phase ends with: unit/integration tests green, the code-quality pipeline (working rule 4: review → simplify → `snyk_code_scan` → final review), and the cross-tenant suite green.

---

## Phase 0 — Foundation: monorepo, guards, CI, infra skeleton

*Nothing tenant-facing ships here; this phase makes violating the architecture harder than following it.*

- [DONE] 0.1 Scaffold pnpm + Turborepo workspace per ADR-0009: `apps/{api,portal-api,worker,web}`, `libs/{data,auth,permissions,ai-providers,contracts,config}`, `infra/`, `test/{cross-tenant,evals}`; `.nvmrc`, engines pinning; per-app Dockerfiles (distroless, non-root) with Turborepo prune.
- [DONE] 0.2 `libs/data` core (ADR-0001): `Scope` type, `ScopedRepository` / `OwnerScopedRepository`, `MissingScopeError`, fail-closed backstop plugin, `SystemScope.run(reason, fn)` with audit-event write; `nestjs-cls` wiring. 6 unit tests green (fail-closed, tenant injection, caller-tenantId-cannot-override, aggregate `$match`-first, owner-scope MissingScopeError, tenant+owner double filter).
- [DONE] 0.3 Lint guards (ADR-0001 CI guard 1): `mongoose`/`InjectModel` imports banned outside `libs/data` (custom rule `kms/no-raw-mongoose-access` + `no-restricted-imports`); `.aggregate(`/`.bulkWrite(`/`.collection` flagged outside `ScopedRepository` subclasses; `SystemScope` import-restricted to `platform-admin/**`, `jobs/**`. CODEOWNERS file. Smoke-tested against deliberate violations — both restrictions fire together and the `jobs/**` exemption is correctly scoped (found and fixed a flat-config overlap bug where two `no-restricted-imports` blocks silently clobbered each other).
- [DONE] 0.4 CI pipeline (ADR-0009 mapping; audit plan §2): `lint → build → unit → integration → cross-tenant → security` with gitleaks wired; Snyk steps stubbed pending `SNYK_TOKEN`; eval-canary dormant (`if: false`) until P4.
- [DONE] 0.5 Cross-tenant suite harness (test plan §3.1): route-enumeration skeleton + spec file with `it.todo`s for the four replay cases; real fixtures land with the first controller (task 2.1+).
- [DONE] 0.6 Terraform skeleton (ADR-0007): network module (VPC + 3 subnets + egress firewall rules), redis module (**2 Memorystore instances**, `redis-app` volatile-lru / `redis-queue` noeviction + memory alert), gcs module (data+audit buckets, CMEK, WORM retention), secrets module (KMS keyring, Argon2 pepper, provider-key secrets), cloud-run module (6 services + clamd, per-service SAs, subnet egress). **Not yet run** — needs a real GCP project id/billing account (see `infra/README.md`); HCL not validated against a live provider since `terraform` CLI isn't installed locally.

**Exit criteria:** CI config green in principle (not yet run against a real PR); **the full pnpm workspace builds, lints, and unit-tests clean** (`pnpm turbo run build lint test:unit` — 20/20, 20/20, 16 tests across 3 suites, all passing) — verified directly, not claimed; a demo test proved an unscoped query throws (backstop-equivalent behavior confirmed via `ScopedRepository` unit tests) and a banned import fails lint (smoke-tested). `terraform apply` / hello-world Cloud Run deploy **not yet exercised** — blocked on real GCP credentials, which only the user can provision.

## Phase 1 — Identity & tenancy core

- [ ] 1.1 Collections + repositories: `tenants`, `users` (ADR-0002); seed/bootstrap flow for the first tenant.
- [PARTIAL] 1.2 Auth module (ADR-0004): **DONE** — Argon2id (64 MiB×3, HMAC-pepper pre-hash) in `libs/auth/src/password.ts` with 4 passing unit tests; `SessionService` on `redis-app` (`__Host-kms_sess`/`__Host-kms_padm`, both idle/absolute clocks, rotation, mass revocation via `user-sess` index) with 6 passing unit tests (create/get/expire/revoke/revokeAll/rotate/realm-isolation). **NOT DONE** — breach-list check, TOTP + KMS envelope encryption + backup codes, password reset flow, ToS gate.
- [ ] 1.3 Login hardening: constant-time uniform failures (dummy verify — `getDummyHash` scaffolded but not wired into a login controller), progressive delay/lockout/CAPTCHA, sec §8.3 failed-login alerts. Timing property CI-asserted (test plan §3.2).
- [DONE] 1.4 Auth guard populates the full CLS scope `{tenantId, userId, role, edition}` — `apps/api/src/auth/session-auth.guard.ts` (`SessionAuthGuard`, reads the `__Host-kms_sess` cookie, looks up `redis-app`, calls `scopeFromIds` from `@kms/data`, never trusts request input for identity). `@Edition`/`@EditionExempt` decorators + `EditionGuard` (404) + bootstrap `assertEditionCoverage` wired as global `APP_GUARD`s in `apps/api/src/app.module.ts` (ADR-0009 G2). Builds clean; `HealthController` is the first `@EditionExempt()` example. Not yet exercised against a live login flow (needs 1.2's remaining pieces + a real login controller).
- [ ] 1.5 Tenant-admin user management: CRUD, deactivation-revokes-sessions, CSV import with the same enumeration discipline (PRD §6).
- [ ] 1.6 `portal-api` skeleton (ADR-0004 realm): builds and boots (health check only); `platformAdmins`, two-person MFA reset, tenant CRUD under `SystemScope.run`, optional IP allowlist still to do.
- [ ] 1.7 `web` shell: Next.js app boots with an RTL `<html lang="he" dir="rtl">` root layout and a placeholder page; login/TOTP screens, edition-driven navigation, and the admin-hostname UI area are not yet built.
- [ ] 1.8 **ADR-0010 schema migrations** — execute `docs/plans/adr-0010-schema-migrations-10-07-2026-plan.md`; wire the migration step into the deploy pipeline and the schema-change CI gate.

**Exit criteria:** cross-tenant suite green over all live routes; session/lockout/timing tests green (test plan §3.2); a KB-edition user gets 404 on OCR-E routes and vice versa; staging login works end-to-end in Hebrew RTL.

## Phase 2 — Folders, permissions, file storage

- [ ] 2.1 `folders` tree + `groups` + folder-permission records (ADR-0002/0005); ~2,000-folders/tenant cardinality bound enforced with a friendly error.
- [ ] 2.2 Permission resolution (ADR-0005): pure function (depth-sorted, override-not-merge, principal union, `isPublic`), versioned Redis cache keyed `{tenantId,userId,permVersion}`, per-tenant `permVersion` bump on any grant change; Redis-outage fallback = per-request recompute.
- [ ] 2.3 Upload path (ADR-0006/0003): API-streamed, magic-byte + 50 MB pre-buffer checks, quota gate **before** enqueue, `documents`/`documentVersions` records, per-tenant GCS prefixes.
- [ ] 2.4 Serving: V4 signed URLs ≤ 5 min, attachment-only, permission re-check at issuance (ADR-0006); download audit events.
- [ ] 2.5 Recycle bin + deletion machinery: `recycleBinEntries`, purge jobs, `deletionVerifications` + certificates (ADR-0002/0006).
- [ ] 2.6 UI: folder tree, upload with progress, document list/states, permission-management and group screens (UI spec P0).
- [ ] 2.7 Tests: permission-matrix integration suite (inheritance/override/public), 404-not-403 assertions folded into the cross-tenant suite, signed-URL expiry + tamper tests (test plan §3.3–3.4).

**Exit criteria:** a user sees exactly their permitted tree; grant changes take effect within the cache-version rules; deletion produces a verification record; all P2 tests green.

## Phase 3 — Ingestion pipeline

- [ ] 3.1 BullMQ topology (ADR-0003): stage queues `scan→parse|ocr-*→chunk→embed→index` on `redis-queue`; `WORKER_POOL` selection with boot-time queue/SA assertion (ADR-0009); job payload scope rehydration into CLS.
- [ ] 3.2 clamd service + `scan` stage (in-VPC, freshclam-only egress, stale-signature alert); infected ⇒ reject + audit.
- [ ] 3.3 `parse` stage in the sandboxed pool: XXE off, zip-bomb/entry-count/pixel guards, pinned parsers, stage timeouts (sec §4.4).
- [ ] 3.4 **Failure taxonomy + circuit breaker** (design review finding 2): defect-vs-transient classifier, extended backoff holding `processing`, per-queue pause/canary/resume breaker, PRD §5 provider panel + sec §8.3 alerts, DLQ + poison-pattern alerting for defects only.
- [ ] 3.5 `chunk` stage: splitting, language detect, page mapping (ADR-0002 schema).
- [ ] 3.6 OCR stages: Classic (Google Vision primary, Azure fallback) + Advanced (vision LLM via `libs/ai-providers`), admin Classic-only enforcement; **atomic quota reservation** at enqueue + idempotent `usageEvents` upserts on `{versionId, stage}` with a concurrency test (design review finding 7; PRD §9).
- [ ] 3.7 Processing-queue UI: per-user personal queue, sanitized actionable errors, retry button (defects only), "provider delay" state (PRD §8).
- [ ] 3.8 Tests: poison-file corpus (zip bomb, XXE, decompression bomb), per-stage idempotency re-runs, breaker behavior under simulated 5xx storms, egress canary probe against `snet-parse` in staging (test plan §3.3).

**Exit criteria:** a clean document reaches `chunk` output artifacts in GCS; an infected/poison file is rejected with audit + alert; a simulated provider outage produces queue lag and zero `failed` documents; p95 stage budgets measured.

## Phase 4 — Retrieval & chat *(gate phase — depends on lane E1)*

**Lane E1 (parallel — start during P1, owner + assistant authored):**
- [ ] E1.1 Author Hebrew golden datasets (test plan §4.1): `heb-qa` (300), `heb-prefix` (80), `exact-term` (100), `mixed-lang` (60), `not-found`, `inject-docs`, `ocr-heb`; store under `test/evals/` with provenance notes.
- [ ] E1.2 Eval harness runnable in CI (binary criteria, LLM-judge two-model rule, judge-validation session — test plan §4.0).

**Main lane:**
- [ ] 4.1 `embed` + `index` stages; Atlas Vector (768-dim, parameterized on ADR-0008) + Atlas Search indexes with Hebrew dual-analyzer (H1, token-expansion fallback H2); purge-then-insert latest-version-only indexing (ADR-0002).
- [ ] 4.2 `libs/ai-providers`: `ChatProvider`/`EmbeddingProvider`/`VisionOcrProvider` interfaces; Vertex adapters (IAM auth, pinned regional endpoints, batching 32, `Retry-After`, `usageEvents`); Claude/Cohere/OpenAI fallback adapters (ADR-0008); endpoints pinned into the `snet-ai` allowlist.
- [ ] 4.3 `buildScopedRetrievalQuery` — the single audited constructor: tenant + permitted-folder pre-filter inside the query, RRF hybrid fusion (ADR-0002); standalone search endpoint reuses it.
- [ ] 4.4 **Run the ADR-0008 Hebrew benchmark gate** on real staging indexes; record results in ADR-0008 Status; on failure follow the ADR's Vertex→Cohere→OpenAI procedure (never silent threshold changes). **This finalizes the provider commitment.** Prefer dimension-compatible fallbacks (design review finding 6).
- [ ] 4.5 Chat: prompt architecture verbatim from ADR-0008 (delimited untrusted chunks, no tools), fail-closed grounding (empty set ⇒ no provider call), streamed answers, server-side citations with permission re-check on click, suggested follow-ups from shown content only; locked-down markdown renderer (text-only, no remote loads — UI spec §3.5).
- [ ] 4.6 Cost/limit controls: 30 msg/h, tenant token budgets, input caps, spend alerts reconciled to `usageEvents` within 2% (test plan §4.10).
- [ ] 4.7 Chat/search UI: conversation list (owner-scoped `conversations`/`messages` via `OwnerScopedRepository` — ADR-0001), citations with page links, "not found" state, bilingual behavior.
- [ ] 4.8 Tests: retrieval pre-filter assertions (filter inside the query — test plan §3.5), eval suites §4.2–§4.6 (retrieval, faithfulness ≥ 97%, injection classes 0 successes), prompt-canary wiring live in CI.

**Exit criteria:** benchmark gate PASSED and recorded (or fallback adopted per procedure); a Hebrew question over staged documents returns a grounded, cited, permission-correct answer; injection suite at zero successes.

## Phase 5 — Smart OCR edition, portal completion, notifications

- [ ] 5.1 OCR-E flows (PRD §15): private directory over `ocrFiles` (`OwnerScopedRepository`), upload→scan→ocr→download chain (chunk/embed/index never enqueued), 7-day TTL hard deletion with surviving metering, per-user page quotas + token caps.
- [ ] 5.2 OCR-E admin: users/quotas/metering screens with **no code path to file contents** (sec §3.5); edition-replay tests extended.
- [ ] 5.3 Portal completion: platform health (queue depth/age, error rates, breaker/provider status — PRD §5), tenant quotas, audit-event views (WORM export to the audit bucket — ADR-0006), spend dashboards.
- [ ] 5.4 **Transactional email provider decision** (design review finding 11: EU processing, DPA, named egress) + flows: OCR completion, password/MFA-change notifications, security alerts.
- [ ] 5.5 Favorites/recents; PostHog wiring per `docs/analytics/posthog_analytics_v01.md` (EU cloud, server-side capture, no content/query text ever).

**Exit criteria:** both editions coexist on one staging deployment with the full cross-tenant/edition suite green; a tenant admin provably cannot reach OCR-E file contents or private chat history.

## Phase 6 — Hardening & launch gates

- [ ] 6.1 sec §12 MVP acceptance checklist walked item-by-item with evidence (traceability table in the system overview is the index).
- [ ] 6.2 Audit program: L2 deep review of security-sensitive paths, `/security-review` + `oc-security-audit` pass, ZAP baseline scan against staging (audit plan §3–4); schedule the pre-GA pentest (≤ 18 mo cadence starts).
- [ ] 6.3 Load test at MVP scale ×2: validates p95 targets, **M10 Search headroom and composite-SLA reality** (design review finding 5 — adopt Atlas Search Nodes if hybrid latency misses); revisit the 50 MB upload threshold with real Hebrew documents (finding 12).
- [ ] 6.4 DR drill: Atlas snapshot restore + `terraform apply` rehearsal against RPO ≤ 24 h / RTO ≤ 8 h (test plan §8.3); backup/restore evidence recorded.
- [ ] 6.5 Upgrade-gate rehearsal (test plan §8): dependency-bump lane, model-version-pin change through the eval gates.
- [ ] 6.6 Compliance start: DPA verification for all sub-processors (Vertex zero-retention + EU terms first), PPA runbook, SOC 2 Type II evidence collection kickoff (audit plan §4).
- [ ] 6.7 Production project `terraform apply`; run all migrations (ADR-0010) staging→prod; go-live checklist.

**Exit criteria:** every sec §12 item has recorded evidence; pentest scheduled; production stands up from IaC + CI alone.

---

## Standing rules across all phases

- **Tests ship with the feature** (working rule 3); random-ID test data; cross-tenant suite is the merge gate from Phase 1 on.
- **Code-quality pipeline** (working rule 4) closes every feature ≥ 3 files.
- **No scope-reopening:** settled decisions live in the resolution log and ADRs; deviations get flagged, not slipped in.
- **Deferred-finding triggers** (design review record): pool merge + clamd sidecar at Terraform module time (P0/P3); availability math + upload threshold at load test (P6).
- Update this plan with `[DONE]` statuses, key decisions, and verification results as phases complete; keep CLAUDE.md current-state only.
