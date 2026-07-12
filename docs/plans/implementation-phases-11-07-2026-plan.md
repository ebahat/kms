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

- [DONE] 1.1 Collections + repositories: `tenants`, `users` (ADR-0002); seed/bootstrap flow for the first tenant. `libs/data/src/models/{tenant,user}.schema.ts` (Mongoose schemas; `users` carries the backstop plugin, `tenants` deliberately does not — it has no tenantId, it IS the tenant); `TenantsRepository` (plain, platform-admin-only, non-`ScopedRepository`) and `UsersRepository` (extends `ScopedRepository`, plus a `findByEmailForAuth` routed through `SystemScope.run` for the pre-auth cross-tenant email lookup — MVP resolves tenant FROM email since there's no per-tenant hostname routing). `apps/api/src/bootstrap/seed.ts` creates the first tenant + admin user, idempotent on email. 7 new unit tests passing (17 total in `libs/data`).
- [DONE] 1.2 Auth module (ADR-0004): Argon2id (64 MiB×3, HMAC-pepper pre-hash) in `libs/auth/src/password.ts`; `SessionService` on `redis-app` (`__Host-kms_sess`/`__Host-kms_padm`, both clocks, rotation, mass revocation). TOTP (`libs/auth/src/totp.ts`, otplib, ±1 step) + 10 single-use Argon2id-hashed backup codes (`backup-codes.ts`) + KMS envelope encryption (`kms-envelope.ts` — `KmsKeyProvider` interface with a `LocalMasterKeyProvider` dev/test binding; production swaps in a Cloud KMS-backed provider behind the same interface once `infra/` is applied). Breach-list check via HIBP k-anonymity range API (`breach-check.ts`, only a 5-char SHA-1 prefix ever leaves the process). Password reset: 128-bit token, SHA-256 hash + ≤30min expiry (`password-reset.ts`); `users.passwordResetTokenHash`/`passwordResetExpiresAt` fields added. ToS gate: `SessionRecord.tosVersion` (optional — absent for platform realm), `TosGateGuard` (apps/api, 451 Unavailable For Legal Reasons on mismatch, `@TosExempt()` escape hatch), wired as `APP_GUARD` between `SessionAuthGuard` and `EditionGuard`; `CURRENT_TOS_VERSION` + `@TosExempt()` in `libs/contracts/src/tos.ts`. Also fixed a real gap: `apps/api`/`apps/portal-api`/`apps/worker` had `jest`+`ts-jest` deps but no `@types/jest` or `jest.config.js` — `test:unit` was silently a no-op via `--passWithNoTests`. 22 new unit tests (36 total in `libs/auth`, 4 in `apps/api`). **Still open (moved to 1.3):** wiring `getDummyHash`/breach-check/TOTP into a real login controller, and a `@Public()` route exemption on `SessionAuthGuard` (needed before any unauthenticated route — login itself — can exist).
- [DONE] 1.3 Login hardening + login controller (ADR-0004): `apps/api/src/auth/auth.controller.ts` — `POST /auth/login` (uniform-timing dummy verify wired in, progressive delay from the 3rd failure/CAPTCHA hook from the 5th/lockout at the 10th via `login-hardening.ts`'s pure `decideLoginHardening()`, sec §8.3 alert hooks), `POST /auth/totp` (TOTP + backup-code verify, 5/5min rate limit, session rotation + `mfaVerified` flip), `POST /auth/tos/accept`, `POST /auth/password-reset/{request,confirm}` (breach-check wired, revokes all sessions), `POST /auth/logout`. New guard-chain plumbing this required: `@Public()` (contracts) + `SessionAuthGuard` exemption (unauthenticated routes didn't exist before — login itself would have 401'd against its own guard); `@MfaExempt()` + `MfaGateGuard` (blocks the interim pre-TOTP session from everything but `/auth/totp`+logout); `CaptchaVerifier`/`SecurityAlertSink` interfaces with no-op/logging stubs (no CAPTCHA/alerting provider chosen yet). Also fixed a real gap while wiring this up: `apps/api`/`apps/portal-api` had no `tsconfig.build.json`, so `nest build` was compiling `.spec.ts` files straight into `dist/`, and jest had no `/dist/` ignore — both fixed everywhere. 39 new unit tests (23 total in `apps/api`, including a full `AuthController` suite exercising uniform-error timing, lockout, TOTP happy/sad path, logout, reset-token rejection).
- [DONE] 1.4 Auth guard populates the full CLS scope `{tenantId, userId, role, edition}` — `apps/api/src/auth/session-auth.guard.ts` (`SessionAuthGuard`, reads the `__Host-kms_sess` cookie, looks up `redis-app`, calls `scopeFromIds` from `@kms/data`, never trusts request input for identity). `@Edition`/`@EditionExempt` decorators + `EditionGuard` (404) + bootstrap `assertEditionCoverage` wired as global `APP_GUARD`s in `apps/api/src/app.module.ts` (ADR-0009 G2). Builds clean; `HealthController` is the first `@EditionExempt()` example. Not yet exercised against a live login flow (needs 1.2's remaining pieces + a real login controller).
- [DONE] 1.5 Tenant-admin user management (PRD §6): `apps/api/src/tenant-admin/tenant-users-admin.controller.ts` — list/create/deactivate/reactivate + CSV import, guarded by a new interim `AdminOnlyGuard` (role==='admin'; ADR-0005's full folder-permission RBAC is Phase 2). All tenant-scoped for free via `UsersRepository` — an id from another tenant 404s, never 403s. Deactivation calls `SessionService.revokeAll` (PRD §6 "immediately revokes"). CSV import accepts raw CSV text (no multipart/multer plumbing yet — deferred to the web UI in 1.7, which can forward a File's text content) via `csv-parse`, validates each row independently, and returns a per-row `{row, status, error?}` report so one bad/duplicate row doesn't abort the batch. `POST /tenant-admin/users` returns a generated temp password directly to the admin (no transactional email provider yet — same open item as 1.2's password-reset email). 11 new unit tests.
- [DONE] 1.6 `portal-api` business logic (ADR-0004 realm): `platformAdmins` collection/repo (plain, not tenant-scoped); its own `PlatformSessionAuthGuard`/`PlatformMfaGateGuard`/`PlatformScope` (own CLS namespace — no tenantId/edition concept exists in this realm at all) mirroring apps/api's tenant-realm guards; `PlatformAuthController` (login → TOTP → session, same uniform-timing/rate-limit discipline, **no backup-code fallback** — TOTP loss has no self-service path); `MfaResetController` implementing genuine two-person control (`request`/`approve`, enforced in code that the approver can never equal the requester, not just by convention); `PlatformTenantsController` (create/suspend/reactivate/quota, every call wrapped in `SystemScope.run` — audited by construction, lives under `platform-admin/**` per the lint boundary). Also promoted `login-hardening`, `captcha`, and `security-alerts` from apps/api-local files into `libs/auth` since both realms now need them (shared, not duplicated). IP allowlist still open (deferred to first production deploy per ADR-0004). 42 new unit tests (21 apps/portal-api, 1 libs/data, plus the login-hardening suite moved into libs/auth's count).
- [DONE] 1.7 `web` login/TOTP screens + RTL shell (UI spec A1-A4, E1): `/login` (uniform error copy, CAPTCHA-hook state), `/login/totp` (combines A2 challenge + A3 first-login enrollment — QR generated **client-side only** via the `qrcode` package so the raw TOTP secret never leaves the browser over the network; 10 backup codes shown once), `/tos-accept` (A4, reached automatically via a 451 interceptor in `lib/api.ts` — works for any future protected call, not just a hardcoded route), `/home` (edition-driven nav via a new `GET /auth/session` whoami endpoint). Admin-hostname UI (ADR-0004 finding 8): `/admin/login`, `/admin/login/totp` (no backup codes — matches the realm's no-self-service-recovery model), `/admin/home` (lists tenants, exercising the 1.6 CRUD live); `middleware.ts` transparently rewrites any `admin.*` hostname request into the `/admin/*` route tree so the same Next.js app serves both realms with zero duplicated frontend. Backend additions this required: `POST /auth/totp/enroll` in both `apps/api` and `apps/portal-api` (no enrollment endpoint existed before — nothing could ever complete first login) and the `GET /auth/session` whoami. Fixed two real environment gaps hit while building this: `apps/web/tsconfig.json` had no `"dom"` in `lib` (inherited the backend-only base config, so `HTMLInputElement`/event types didn't resolve) and `apps/web`'s dev/start scripts collided on port 3000 with `apps/api`'s default (now `apps/web` runs on 3010). Verified with a real `next build` (all 8 new routes prerender clean) and a live `next dev` + Playwright pass (RTL layout confirmed visually, login form submit → uniform error message confirmed against an unreachable backend — no MongoDB available in this sandbox, so the full login→TOTP→home round trip against a live API is **not** verified end-to-end). 12 new backend unit tests (enrollTotp × 2 realms); no frontend test harness exists yet for `apps/web` (none existed before this either).
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
