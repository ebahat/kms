# Architecture Design-Quality Review — 2026-07-10

**Reviewer:** independent design-quality review agent (separate lane from the step-6 consistency review)
**Scope:** ADRs 0001–0009 + `system-overview.md` as an integrated design — runtime resilience, operational surface, cost, and evolution paths. Security architecture was reviewed earlier (consistency pass) and re-confirmed here.
**Verdict:** *"Genuinely strong, internally coherent design… weaknesses are in runtime resilience and operational surface area."* No security findings.
**Disposition decided by owner (2026-07-10):** fix findings 1, 2, 8 now; plan finding 9 (ADR-0010); record the rest with triggers.

## Findings and disposition

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | HIGH | Single Redis serves sessions **and** BullMQ — an ingestion burst can evict sessions (mass logout), and the two workloads need opposite eviction policies (`noeviction` for BullMQ vs TTL-eviction for sessions); one instance cannot satisfy both. | **FIXED** — split into `redis-app` (sessions/counters/perm-cache, `volatile-lru`) and `redis-queue` (BullMQ, `noeviction` + headroom alert). ADR-0007 topology, ADR-0004, ADR-0003, overview updated. |
| 2 | HIGH | Pipeline can't distinguish provider-transient errors (429/5xx/timeout) from document defects — a 30-min provider outage strands every in-flight document in `failed`, each needing a manual retry. | **FIXED** — ADR-0003 failure taxonomy: transient errors hold `status = processing` with extended backoff; per-queue circuit breaker (pause → canary probe → resume) feeding the PRD §5 provider panel + sec §8.3 alert. Only document defects reach `failed`. |
| 3 | MED | Index pool has no security reason to be a separate deployment — its egress (Atlas+GCS+Redis) is a strict subset of the ai pool's. Three pools could be two. | **RECORDED** — revisit when writing the first Terraform worker modules (overview future-ADR list). Sandbox (parse) boundary is untouched either way. |
| 4 | MED | Worker autoscaling should be queue-depth-driven, not CPU-driven (Cloud Run default) — a deep queue with idle CPUs won't scale. | **RECORDED** — implementation note for the ADR-0007 Terraform follow-up: scale worker services on queue-depth metric (or min-instances + concurrency tuning at MVP volume). |
| 5 | MED | Availability math: stacked SLAs (Cloud Run, Atlas M10, Memorystore, LLM provider) compose to ~99.35% < the 99.5% PRD target; Atlas M10 runs Search on the same nodes — sizing risk for hybrid queries. | **RECORDED** — accepted risk at MVP; validate composite SLA and M10 search headroom at first load test; Atlas Search Nodes are the identified remedy if hybrid latency misses. |
| 6 | MED | A post-GA embedding-model swap is a dual-index migration (re-embed all chunks while the old index serves). Fallback providers with different dimensions (Cohere 1024) force an index rebuild, not just a re-embed. | **RECORDED** — prefer dimension-compatible (768 or projectable) fallbacks when the ADR-0008 gate runs; migration mechanics belong to ADR-0010 (see plan). `chunks.embeddingModel` provenance already supports this. |
| 7 | MED | Quota check-then-enqueue is a TOCTOU race — two simultaneous uploads can both pass the check before either is counted; `usageEvents` needs upsert-idempotency on `{versionId, stage}`. | **RECORDED** — implementation requirement: atomic quota *reservation* (single conditional update) at enqueue + idempotent metering upserts; add a concurrency test when the quota service is built (test plan §3 lane). |
| 8 | MED | Separate `portal-web` app is operational overhead with no security value — the frontend holds no trust; the realm boundary is portal-api + user store + cookie + hostname. | **FIXED** — `portal-web` removed; the single Next.js `web` app serves the admin UI on the `admin.…` hostname. ADR-0004, ADR-0007, ADR-0009, overview updated. `portal-api` remains a separate app/realm. |
| 9 | MED | No decision exists for schema migrations/backfills (tooling, `schemaVersion`, tenant-batched backfills under `SystemScope.run`) — improvising this post-launch is painful. | **FIXED** — [ADR-0010](../adr/0010-schema-migrations-and-backfills.md): custom NestJS migration runner (real `SystemScope.run` access, unlike `migrate-mongo`), expand→backfill→contract pattern, roll-forward-only, CI schema-change gate. Written without a live-cluster spike (see its Status section). |
| 10 | LOW | clamd could run as a Cloud Run sidecar of `worker-parse` instead of a separate service. | **RECORDED** — packaging detail, decide in the Terraform module (overview future-ADR list). |
| 11 | LOW | Transactional email provider is undecided ("Email provider" box in the diagram) — needed for password reset, OCR completion, security notifications. | **RECORDED** — small decision before implementing those flows; constraints: EU processing, DPA, named-egress entry (sec §6, §9). |
| 12 | LOW | The 50 MB pre-buffer / API-streamed upload threshold is unvalidated against real Hebrew document sizes. | **RECORDED** — validate with real traffic; the direct-to-GCS future-ADR is the escape hatch (ADR-0006). |

## Reviewer's "do not touch" list (re-confirmed sound)

ADR-0001 four-layer scoping design; retrieval pre-filter inside the Atlas query; ADR-0005 versioned permission cache; the Hebrew benchmark gate mechanics; fail-closed grounding; structural edition gating; deletion-verification machinery; the parse-sandbox network boundary; the `libs/data` monorepo wall.

## Reviewer's cut/defer-for-MVP suggestions (owner disposition)

- Merge index pool → **deferred to Terraform time** (finding 3).
- Fold portal-web → **done** (finding 8).
- clamd sidecar → **deferred to Terraform time** (finding 10).

Everything in this record that is not FIXED carries its trigger inline; nothing requires reopening an Accepted ADR until its trigger fires.
