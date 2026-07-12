# ADR-0010: Schema Migrations & Data Backfills

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Product owner (Ehud); drafted in the implementation-phase pass
**Sources:** design review 2026-07-10 finding 9; `docs/plans/adr-0010-schema-migrations-10-07-2026-plan.md`; ADR-0001 (tenant scoping); ADR-0002 (index design); ADR-0008 (embedding provider gate); ADR-0009 (repo layout/CI); test plan §8.1

## Status

Accepted 2026-07-12. Written without a live-cluster tooling spike (no Atlas cluster is provisioned yet — `infra/` has not been applied) — the tooling decision below is made on documented capabilities and fit with ADR-0001's existing invariants rather than a bake-off. The one thing genuinely deferred to first real usage is validating that `migrate-mongo`'s changelog-collection locking behaves as expected under Atlas; that validation is a Follow-up, not a blocker, because the decision does not depend on it (§Decision explains why).

## Context

MongoDB's schemalessness means nothing *forces* a migration discipline — the failure mode this ADR exists to prevent is three implicit document shapes per collection in production, discovered only when a query breaks. Two aggravating factors specific to this system:

- **Every backfill touches multi-tenant data.** ADR-0001's fail-closed tenant scoping applies with equal force to migrations: `ScopedRepository`/`SystemScope.run(reason, fn)` are "the ONLY sanctioned way application code touches tenant-owned data," and the backstop plugin throws on any unscoped query *in every environment, including migrations* if a migration script reaches a tenant-owned collection outside that path. A migration tool that runs as a bare script with its own raw MongoDB client sits outside this machinery entirely — that is the central fact the tooling decision below turns on.
- **A post-GA embedding-model swap is a realistic event, not a hypothetical** (design review finding 6): ADR-0008's Hebrew-benchmark gate can fail on embeddings only, in which case chunks re-embed against a different provider/dimension while chat continues on the current model. Test plan §8.1 already specifies this migration's shape in full (shadow index → tenant-batched re-embed → cutover → soak → purge); this ADR's job is to fit that shape into a general migration mechanism, not invent a new one.

No collection currently in the codebase (`tenants`, `users`, `platformAdmins` — Phase 1) has a `schemaVersion` field or any migration tooling; this is the first ADR to introduce either.

## Options Considered

The option space collapses to one real fork: **where does a migration run, and does it have access to the application's own DI container** (and therefore to `ScopedRepository`/`SystemScope.run`)? Everything else (versioning model, pattern, rollback stance, CI gate) is a smaller decision made in §Decision once this fork is resolved.

### Option A: Custom NestJS migration command (chosen)

A tiny `migrations/` workspace package (`@kms/migrations`) that boots a `NestFactory.createApplicationContext(AppModule-equivalent)` — the same bootstrap shape already used by `apps/api/src/bootstrap/seed.ts` and `apps/portal-api/src/bootstrap/seed.ts` (Phase 1) — resolves `TenantsRepository`/`UsersRepository`/etc. from the real DI container, and runs one migration class per invocation.

- **Pros:** Migrations get real `ClsService`/`SystemScope.run` access, so a tenant-batched backfill is *structurally* forced through the audited path (import-restricted to `migrations/**`, added to the `systemScopeAllowed` lint list next to `platform-admin/**`/`jobs/**` — ADR-0001) rather than trusting each migration author to remember to call it. Migration files are plain TypeScript classes that import `@kms/data` schemas directly — no drift between "what the app writes" and "what the migration reads." No new runtime dependency; reuses infrastructure this codebase already has working (the seed scripts).
- **Cons:** No off-the-shelf changelog/locking semantics — this ADR must specify them (§Decision, item 2). More code to own than a library.

### Option B: `migrate-mongo`

An established npm package: TypeScript-capable migration files, a `changelog` collection tracking applied migrations, a CLI (`migrate-mongo up/down/create`).

- **Pros:** Mature, documented, zero-maintenance changelog/ordering semantics; wide community usage means Atlas-specific gotchas are likely already known.
- **Cons:** Runs as a standalone script against its own raw driver connection — it has no path into the Nest DI container, so a migration file would need to hand-roll `ClsService.run()` + `SystemScope.run()` plumbing itself, per migration, with no lint/import-restriction backstop to catch a migration that skips it. That is exactly the "structural guarantee, not a convention" gap ADR-0001 was written to close everywhere else in this codebase (lint rule + runtime backstop plugin, both). Adopting `migrate-mongo` here would make migrations the one code path in the system where tenant-scoping is convention-only.

**Decision on the fork: Option A.** The reason this doesn't need a live-cluster bake-off first: the deciding factor (DI/SystemScope access) is a property of the tool's architecture, not something Atlas-specific behavior could overturn. `migrate-mongo`'s changelog-locking behavior under concurrent Cloud Run Job retries is a real open question, but Option A sidesteps it (§Decision item 2 uses a Nest-owned journal collection with the same idempotency property this codebase already relies on elsewhere — see `PlatformAdminsRepository`/`UsersRepository`'s find-then-create idempotency in the seed scripts).

## Decision

**1. Tooling:** Option A. New workspace package `migrations/` (added to `pnpm-workspace.yaml` alongside `apps/*`/`libs/*`), depending on `@kms/data`, `@kms/auth`, `nestjs-cls`. Each migration is a class:

```ts
// migrations/src/002-add-user-display-name.migration.ts
export class AddUserDisplayName extends Migration {
  readonly name = '002-add-user-display-name';

  async up(ctx: MigrationContext): Promise<void> {
    await SystemScope.run(ctx.cls, ctx.auditWrite, `migration:${this.name}`, async () => {
      for await (const tenant of ctx.tenants.find()) {
        await ctx.cls.run(async () => {
          ctx.cls.set(SCOPE_CLS_KEY, scopeFromIds({ tenantId: tenant._id.toString(), userId: tenant._id.toString(), role: 'admin', edition: tenant.edition }));
          await backfillBatched(ctx.users, { displayName: { $exists: false } }, BATCH_SIZE, (doc) => ({
            displayName: doc.email.split('@')[0],
          }));
        });
      }
    });
  }
}
```

`migrations/src/runner.ts` boots `NestFactory.createApplicationContext`, resolves the requested migration class by name from CLI args, checks the journal (item 2) for idempotency, runs `up()`, records completion. No `down()` is required (item 6).

**2. Versioning model:** a `schemaMigrations` journal collection (`{name, appliedAt, reason}`, one document per completed migration — the idempotency check) is the **only** required bookkeeping. A per-document `schemaVersion` field is **not** added blanket to every collection — it is reserved for the narrow case where two document shapes must legitimately coexist in production during a rollout (the re-embed migration below is exactly this case, and it already has its own provenance field: `chunks.embeddingModel`, ADR-0002). Most migrations (add a field, rename a field, backfill a default) complete fully within their `up()` run and need no lingering per-document marker.

**3. Pattern:** expand → backfill → contract, always three deploys minimum for anything that changes what a document *means* (not just adds an unused-yet field):
   1. **Expand** — deploy code that can read the old shape and writes the new shape (new field optional/nullable); ship the migration file but do not run it yet.
   2. **Backfill** — run the migration (tenant-batched, see item 4); verify via the journal that every tenant completed.
   3. **Contract** — a later deploy removes the old-shape read path and the now-redundant field. Never collapsed into one deploy — this is what makes a mid-rollout crash or partial backfill safe to leave running rather than an emergency.

**4. Backfill execution rules:**
   - **Tenant-batched, resumable:** iterate `tenants` (via `TenantsRepository`, no scope required — it's the registry itself); within each tenant, page through the target collection in bounded batches (default 500 documents) using the last-seen `_id` as a resumable cursor, persisted per `{migrationName, tenantId}` in the journal so a crashed run resumes rather than restarts or skips.
   - **Audited:** every tenant's batch runs inside `SystemScope.run(cls, auditWrite, "migration:<name>", fn)` — this is a genuinely cross-tenant *operation* (the migration touches every tenant in sequence) even though each individual write is correctly scoped to one tenant at a time via a real CLS scope set per iteration (shown in the sketch above) — never a raw `Model.updateMany({})` across tenants.
   - **Throttled:** a fixed delay between batches (default 50ms) and single-tenant-at-a-time execution (no parallel fan-out across tenants) bound worst-case load on Atlas RU budget and `redis-app`/`redis-queue` — a backfill must never compete with the ingestion NFR run (test plan §6) or evict sessions (design review finding 1, already the reason `redis-app`/`redis-queue` are split).

**5. Re-embed / index migrations (ADR-0008 coupling):** this is the `chunks`-specific instance of the general pattern, and test plan §8.1 already fully specifies its shape — this ADR does not re-derive it, only confirms it fits: build the new vector/search index alongside the current one (dual-index, both live); re-embed in tenant batches per item 4, with `chunks.embeddingModel` (ADR-0002) as the per-document progress marker (this **is** the `schemaVersion`-equivalent field for this one collection, per item 2); cut retrieval over to the new index **per tenant**, gated on the full §4.2 retrieval suite passing against the shadow index first; purge the old vectors only after a 1-week production soak (test plan §8.1's existing rollback note: "rollback = flip retrieval back" while the old index still exists).

**6. Rollback stance: roll-forward-only.** No migration is required to implement a symmetric `down()`. Rationale: once new documents exist under the new shape (the common case within minutes of `up()` starting on a live multi-tenant collection), a mechanical down-migration risks silent data loss or is simply undefined for documents created after the cutover — an untested `down()` that would rarely be exercised is false confidence, not safety. The real disaster path is Atlas continuous backup / point-in-time restore (ADR-0007 DR). A migration *may* optionally implement `down()` for the narrow class of purely additive, provably reversible changes (e.g., dropping an unused field that nothing has read yet), but the runner and the CI gate (item 7) do not require or assume one.

**7. Delivery integration:**
   - **Where migrations run:** a one-shot Cloud Run Job invocation of `migrations/` as a pre-traffic deploy step (ADR-0007's job-vs-service distinction, already used for nothing else yet but the natural fit) — never bundled into `apps/api`/`apps/portal-api` boot, which would race N replicas into running the same migration concurrently.
   - **Staging-first:** every migration soaks on staging first — minimum 24h for a schema-only change, the existing 1-week soak (test plan §8.1) for re-embed/index migrations — before the same migration runs in production.
   - **CI gate (extends ADR-0009's `lint → build → unit → integration → cross-tenant suite → security scans` pipeline):** a new **schema-change gate** step fails a PR that modifies any file under `libs/data/src/models/**` unless the same PR either (a) adds a corresponding file under `migrations/src/**`, or (b) the modified schema file's diff contains a `// no-migration-needed: <reason>` comment on the changed line (e.g., a genuinely additive optional field on a collection with zero production documents yet). The check is a small script (git diff against both directories), not a new tool — matching the plan's "the option space is small" effort estimate.

## Consequences

- **Positive:** Migrations get the same fail-closed tenant-scoping guarantee as every other code path in the system (lint-restricted import + real `SystemScope.run`), not a convention that only holds if the author remembers; the re-embed migration ADR-0008 will eventually need has a mechanism to live in, already validated against test plan §8.1's independently-derived shape; a PR cannot silently ship a breaking schema change past CI.
- **Negative / accepted risks:** A new workspace package to maintain instead of an off-the-shelf library; the journal/locking semantics under concurrent Cloud Run Job retries are untested until the first real migration ships (accepted — narrow, observable failure mode: a re-run migration would find its own journal entry and no-op, worst case is a wasted job invocation, not double-writes, given `up()` bodies are themselves idempotent backfills keyed on `{$exists: false}`-style filters). No down-migration path — accepted per item 6's reasoning; the bound is "Atlas PITR is the disaster path, not a code path."
- **Follow-ups:** Implement `migrations/` (the package, `Migration` base class, `runner.ts`, the journal schema) as an implementation-phase task before the first schema change that needs one lands; wire the CI schema-change gate into the Turborepo pipeline; validate the journal's idempotency behavior against a real Atlas cluster once `infra/` is applied (the one thing this ADR deferred, per §Status); cross-reference this ADR from ADR-0008 (done — see its §8.1 citation) and from `system-overview.md`'s ADR index (done, this pass).
