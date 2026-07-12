# Plan: ADR-0010 — Schema Migrations & Data Backfills

**Status:** DONE — see [ADR-0010](../adr/0010-schema-migrations-and-backfills.md) (Accepted 2026-07-12) · **Origin:** design review 2026-07-10, finding 9 (`docs/architecture/design-review-2026-07-10.md`)
**Deadline anchor:** must be **Accepted before the first production deploy** — retrofitting a migration discipline onto live tenant data is the failure mode this ADR exists to prevent.
**Effort estimate:** one focused session — a short ADR (the option space is small) + a walkthrough of one worked example.

## Why this ADR is needed

MongoDB's schemalessness means nothing *forces* a migration story — which is exactly how production data ends up with three implicit document shapes per collection. This system has aggravating factors: every backfill touches multi-tenant data (so it must run under the audited `SystemScope.run` escape hatch of ADR-0001), and ADR-0008's provider gate makes a **re-embed migration** (all `chunks` rewritten against a new embedding model, possibly with a new vector-index definition) a realistic post-GA event, not a hypothetical (design review finding 6).

## Decisions ADR-0010 must make

1. **Tooling** — `migrate-mongo` vs a custom NestJS CLI command (`nest start --entryFile migrate`). Evaluation axes: TypeScript-native migration files, access to `libs/data` schemas (so migrations reuse the scoped-repository layer instead of raw drivers), journal/lock semantics on Atlas, dry-run support.
2. **Versioning model** — per-collection `schemaVersion` field vs a global `migrations` journal only. Recommendation to evaluate first: journal for *applied migrations*, `schemaVersion` on documents only for collections that need lazy/rolling rewrites.
3. **Pattern** — expand → backfill → contract (never a breaking change in one deploy); which steps run in CI/CD vs as operator-triggered jobs.
4. **Backfill execution rules** — tenant-batched iteration (bounded batches, resumable cursor, per-tenant progress record), run under `SystemScope.run(reason, …)` so every cross-tenant touch is audited (ADR-0001); throttling so a backfill cannot starve production load or blow the `redis-queue`/Atlas budgets.
5. **Re-embed / index migrations** (the ADR-0008 coupling) — dual-index strategy: build the new vector/search index alongside, re-embed in tenant batches with `chunks.embeddingModel` provenance, cut reads over per tenant, drop the old index; abort/rollback semantics.
6. **Rollback stance** — down-migrations vs roll-forward-only (with Atlas snapshot as the disaster path per ADR-0007 DR); pick one and state it.
7. **Delivery integration** — where migrations run in the deploy pipeline (pre-deploy step vs release job), staging-first rule, and the CI gate: a PR that changes a `libs/data` schema without a migration (or an explicit no-migration annotation) fails.

## Steps

- [SKIPPED] 1. Spike: `migrate-mongo` vs custom Nest command against a scratch Atlas cluster (½ the session). No Atlas cluster exists yet (`infra/` not applied) — the decision was made on documented tool architecture instead (DI/SystemScope access is a property of the tool, not something a live bake-off could overturn; see ADR-0010's Status/Options sections). Live validation of the journal's locking behavior remains a Follow-up.
- [DONE] 2. Write ADR-0010 in `docs/adr/` using `docs/adr/template.md` (options table, decision, consequences).
- [DONE] 3. Worked examples: `users.displayName` (simple expand→backfill→contract, using a collection that actually exists in the codebase today rather than the plan's original `folders.color` placeholder — folders don't exist until Phase 2) AND the re-embed migration, which cites test plan §8.1's already-fully-specified shape rather than re-deriving it.
- [DONE] 4. Cross-reference updates: ADR-0008 already cited test plan §8.1 correctly (no change needed there); test plan §8.1 intro now cites ADR-0010; ADR-0009 CI mapping now lists the schema-change gate; system-overview ADR index moved 0010 from "future candidates" to the Accepted table; design-review-2026-07-10.md finding 9 disposition updated PLANNED → FIXED.
- [DONE] 5. Consistency check against ADR-0001 (SystemScope signature/import-restriction pattern), ADR-0002 (vector index fields, confirmed no pre-existing `schemaVersion`), ADR-0007 (Cloud Run Job as the natural home, matching the worker-pool job/service distinction) — marked Accepted.

## Constraints carried in from existing ADRs

- No migration path may bypass the ADR-0001 layers: backfills use repositories/`SystemScope.run`, never raw `Model.collection`.
- Vector-index changes are staged, never in-place (Atlas index builds are online but re-embed cost is provider-billed — budget note for the pricing doc).
- All migration runs are audit events (sec §8.1); operator-triggered backfills need the two-person rule only if they read content (sec §3.5 posture).
