# ADR-0009: Repository Layout and Edition Gating

**Status:** Accepted (2026-07-10)
**Date:** 2026-07-10
**Deciders:** Product owner (Ehud); drafted in the architecture/ADR pass
**Sources:** PRD §1, §15, §16; sec §10; ADR-0003 (enqueue-time gating), ADR-0004 (portal app), ADR-0008 (provider lib)

## Status

Accepted 2026-07-10 — step-6 consistency review passed; review fixes applied (findings record in the plan).

## Context

Deployables: NestJS API, NestJS admin-portal API (separate realm, ADR-0004), three worker deployments sharing one codebase (ADR-0003), Next.js web app (which also serves the platform-admin UI on the admin hostname — ADR-0004; design review 2026-07-10, finding 8), Terraform (ADR-0007) — all TypeScript except infra. Cross-cutting code: scoped repositories (ADR-0001), retrieval builder (ADR-0002), AI provider adapters (ADR-0008), auth library (ADR-0004), DTO/validation contracts shared with the frontend.

Two editions ship from one codebase: Knowledge Base and Smart OCR standalone, assigned **per tenant** (PRD §1, §15) — both edition types coexist on the same shared cluster and the same deployment (PRD §4), so edition separation is a runtime concern, not a build concern. Sec §10 requires CODEOWNERS labeling of security-sensitive paths and CI gates per PR.

## Options Considered

### Option A: pnpm-workspaces monorepo with Turborepo task graph (chosen)

```text
apps/
  api/            NestJS — tenant-facing API (both editions)
  portal-api/     NestJS — platform-admin realm (ADR-0004)
  worker/         NestJS — one codebase, three deployments selected by WORKER_POOL env (parse|ai|index; ADR-0003)
  web/            Next.js — tenant UI (both editions) + platform-admin UI on the admin.… hostname (ADR-0004)
libs/
  data/           schemas, ScopedRepository/OwnerScopedRepository, backstop plugin (ADR-0001), retrieval builder (ADR-0002)
  auth/           Argon2id/TOTP/session primitives shared by both realms (ADR-0004)
  permissions/    resolution function + cache (ADR-0005)
  ai-providers/   ChatProvider/EmbeddingProvider/VisionOcrProvider adapters (ADR-0008)
  contracts/      DTOs + zod/class-validator schemas shared API↔web
  config/         typed env/config loading, edition definitions
infra/            Terraform (ADR-0007)
test/
  cross-tenant/   the sec §10 suite (test plan §3.1)
  evals/          datasets + harness (test plan §4)
```

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — workspace wiring once; Turborepo caches build/test per package |
| Invariant enforcement | Strong — ADR-0001's lint rule ("`mongoose` imports only in `libs/data`") is a workspace boundary, not a convention |
| CI fit | Per-package affected-graph runs keep the every-PR gates (sec §10; test plan §2) fast |
| Team fit | One PR spans API+web+contracts atomically — right for a small team |

- **Pros:** Shared security-critical code (`libs/data`, `libs/auth`) exists exactly once — no drift between API and workers (ADR-0003 workers rehydrate the same CLS scope); contracts package eliminates API/frontend type skew; CODEOWNERS paths are package paths.
- **Cons:** Workspace tooling is a build-infra dependency; deploy pipelines must map one repo → six Cloud Run services plus clamd (ADR-0007) — solved with per-app Dockerfiles + Turborepo pruning.

### Option B: Polyrepo (api / web / workers / infra)

- **Pros:** Independent versioning; smaller CI checkouts.
- **Cons:** `libs/data` (the isolation mechanism, ADR-0001) becomes a published package — version skew between API and workers on the *tenant-scoping code* is a security hazard, not an inconvenience; cross-cutting changes (DTO + API + UI) need coordinated PRs; a small team pays polyrepo overhead with none of its org-scale benefits. Rejected.

**Decision: Option A.** Package manager: **pnpm** (workspace-native, disk-efficient); Node LTS pinned in `.nvmrc`; this satisfies working rule 3's "use the project's own package manager" going forward.

## Options Considered — edition gating

### Option G1: Feature flags checked in handlers

`if (tenant.edition === 'ocr') …` sprinkled at each divergence point.

- **Pros:** Cheap to start.
- **Cons:** The critical invariants — "OCR-E files never indexed" (PRD §15), "no navigation path to file contents for admins" (sec §3.5) — become N scattered conditionals, each a place to forget. Rejected for the security-relevant divergences.

### Option G2: Structural composition + one guard (chosen)

Edition differences are expressed **structurally** where they are security-relevant and by a single declarative guard where they are merely visibility:

1. **Pipeline:** the Smart-OCR flow never enqueues `chunk/embed/index` (ADR-0003) — enforced at the single enqueue point, already decided.
2. **Modules:** NestJS module composition registers KB-only controllers (folders, chat, search, favorites) and OCR-E-only controllers (personal directory) unconditionally in code, but every controller is annotated `@Edition('kb' | 'ocr' | 'both')`; a global `EditionGuard` reads the tenant's edition from the CLS scope (ADR-0001) and returns **404** (not 403 — sec §3.2 consistency) for out-of-edition routes.
3. **Data access:** OCR-E file records only via `OwnerScopedRepository` (ADR-0001) — edition-independent structural rule.
4. **Frontend:** `libs/contracts` exports the edition→surface map; `web` renders navigation from it (UI spec §2 roles table).

- **Pros:** Each PRD §15 invariant has exactly one enforcement point, and the cross-tenant/edition suite (test plan §3.1) replays KB routes under an OCR-E tenant asserting 404.
- **Cons:** A new route must declare its edition — enforced by making the decorator mandatory (bootstrap-time assertion fails on undecorated controllers).

## Decision

Option A layout + G2 gating, plus the delivery/oversight mechanics:

### CODEOWNERS (sec §10 security-sensitive paths)

```text
libs/data/**            @owner   # tenant scoping, retrieval builder (ADR-0001/0002)
libs/auth/**            @owner   # ADR-0004
libs/permissions/**     @owner   # ADR-0005
apps/worker/src/parse/** @owner  # file parsing (sec §4.4)
apps/api/src/chat/prompt/** @owner # prompt construction (sec §5.1; ADR-0008)
apps/api/src/files/**   @owner   # upload/signing (ADR-0006)
infra/**                @owner   # Terraform (sec §6)
test/cross-tenant/**    @owner   # the gate itself must not be weakened silently
```

(Single-owner project today — the value is the *labeling*: these paths trigger the L2 deep-review lane in the audit plan §3 and can gain human reviewers later.)

### CI mapping (test plan §2 / audit plan §2 land here)

Turborepo pipeline: `lint → build → unit → integration → cross-tenant suite → security scans → schema-change gate`; eval canary job triggers on changes under `apps/api/src/chat/**`, `libs/ai-providers/**`, `apps/worker/src/chunk/**`, or `test/evals/**` (test plan §4.8). Worker image is built once; the three pools deploy the same image with different `WORKER_POOL` env and different service accounts/subnets (ADR-0007) — the sandbox distinction is infrastructure, not build flavor. The schema-change gate (ADR-0010) fails a PR that edits `libs/data/src/models/**` without an accompanying migration or an explicit no-migration-needed annotation.

## Consequences

- **Positive:** The isolation-critical code paths have single homes with owner-labeled review lanes; edition invariants are structural (one enqueue point, one guard, one repository class) and behaviorally tested; a future third edition is a decorator value + module set, not a codebase fork.
- **Negative / accepted risks:** Monorepo couples deploy cadence across apps (acceptable — they version together by design); Turborepo/pnpm are toolchain lock-ins with easy exits; the `WORKER_POOL` env selecting behavior means a mis-set env var runs the wrong processor — mitigated: pool startup asserts its queue set matches its service account's permissions (fail-fast at boot, ADR-0007 IAM makes the wrong pool unable to reach the wrong resources anyway).
- **Follow-ups:** Scaffold the workspace as implementation-phase task 1 (with lint rules from ADR-0001 and the CI pipeline above wired before feature code — working rule 3); `.nvmrc`/engines pinning; per-app Dockerfiles with Turborepo prune; edition-replay cases added to the cross-tenant suite (test plan §3.1).
