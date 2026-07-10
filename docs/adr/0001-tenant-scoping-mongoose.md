# ADR-0001: Tenant Scoping at the Mongoose Data Layer

**Status:** Accepted (2026-07-10)
**Date:** 2026-07-07
**Deciders:** Product owner (Ehud); drafted in the architecture/ADR pass
**Sources:** PRD §4, §13, §15, §16; sec §3.1, §3.2, §3.5, §3.6, §10; `requirements_review_v01.md` resolution log

## Status

Accepted 2026-07-10 — step-6 consistency review of the full ADR set passed; review fixes applied (findings record in `docs/plans/architecture-adr-pass-07-07-2026-plan.md`).

## Context

The isolation model is settled: a single shared MongoDB Atlas cluster with mandatory `tenantId` scoping enforced at the data-access layer — "no query may execute without a tenant scope" (PRD §4; resolution log). The security spec makes this the highest-impact control in the system (sec §3.1, "the crown jewels") and imposes hard constraints on *how* it is enforced:

- `tenantId` is derived server-side from the authenticated session — never from request body, query param, or header (sec §3.1).
- The repository layer injects the tenant filter on every operation, and "a lint rule/wrapper makes it impossible to call a model method without tenant scope" (sec §3.1).
- Every read/write re-validates both tenant and folder permission; out-of-tenant resources return 404, not 403 (sec §3.2).
- The Smart OCR standalone edition needs the same mechanism one level deeper: per-user directory isolation, with `userId` derived from the session and enforced at the repository layer (PRD §15; sec §3.6). Tenant admins must have no code path to users' file contents in that edition (sec §3.5).
- A cross-tenant isolation test suite runs on every PR and is "the single most important test asset in the codebase" (sec §10).

The stack is NestJS + Mongoose (PRD §16), which bounds the option space: enforcement must work with Mongoose query/aggregation semantics, including the places where naive hooks fail (aggregation pipelines, `bulkWrite`, `distinct`). The mechanism must hold at MVP scale (20 tenants / 8,000 users, PRD §13) and at 10× without redesign — which it does trivially, since it is a code-structure control, not a capacity control.

Platform-admin operations (PRD §5) and system jobs (deletion-verification, quota rollups) legitimately operate across tenants; the design must give them an explicit, audited escape hatch rather than an implicit one.

## Options Considered

### Option A: Tenant-scoped base repository only

All data access goes through a `ScopedRepository<T>` base class that injects the tenant filter; direct model access is forbidden by convention + lint.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — one abstract class, no Mongoose middleware subtleties |
| Enforcement strength | Medium — static analysis only; a lint suppression or unlinted path bypasses it |
| Aggregation coverage | High — repository prepends `$match` explicitly, works for any pipeline |
| Smart-OCR reuse | High — scope is an explicit object, easy to extend to `{tenantId, ownerUserId}` |

- **Pros:** Explicit and readable — the scope is visible in one place; trivially covers aggregations, `bulkWrite`, `distinct`; scope descriptor generalizes cleanly to per-user scoping (sec §3.6).
- **Cons:** The guarantee is only as strong as the lint rule; a developer who injects a raw model in a new module and suppresses the rule ships a cross-tenant bug with no runtime backstop.

### Option B: Global Mongoose plugin only

A global plugin registers `pre` hooks on `find*`, `count*`, `update*`, `delete*`, `aggregate`, and save paths, injecting/asserting `tenantId` from request context.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — hook coverage must be audited per Mongoose version |
| Enforcement strength | Medium-high at runtime, but implicit ("magic") |
| Aggregation coverage | Partial — a `pre('aggregate')` hook can prepend `$match`, but `$lookup`/`$unionWith` sub-pipelines join unscoped collections invisibly |
| Smart-OCR reuse | Medium — dual-key scoping via plugin options is doable but opaque |

- **Pros:** Applies automatically to every model; no developer action needed on the happy path.
- **Cons:** Implicit injection hides the control from readers and reviewers; known coverage gaps (`$lookup` inner pipelines, `bulkWrite`, `Model.collection` escape hatch) mean "plugin only" cannot honestly claim "no query without a tenant" (PRD §4); query construction stays scattered across services, which sec §4.2's injection rules also discourage.

### Option C: Scoped repository as the only sanctioned API + global plugin as a fail-closed backstop (chosen)

Option A's repository is the sole way application code touches data; Option B's plugin is retained purely as a runtime assertion that throws if any query reaches a tenant-owned model without the expected tenant filter.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — both mechanisms, but the plugin shrinks to an assertion |
| Enforcement strength | High — static guard (lint) + structural guard (repository) + runtime fail-closed guard (plugin) + behavioral guard (CI cross-tenant suite) |
| Aggregation coverage | High — repository handles pipelines; plugin asserts the first stage is a tenant `$match` |
| Smart-OCR reuse | High — same as Option A |

- **Pros:** Defense in depth on the highest-impact failure mode (sec §0 threat table: cross-tenant attacker); each layer catches a different bypass class.
- **Cons:** Two mechanisms to keep consistent; the assertion plugin must be updated when new query paths are introduced.

## Decision

**Option C.** The repository is the API; the plugin is a tripwire, not a feature.

### Request-context propagation

Tenant identity travels via `AsyncLocalStorage` using `nestjs-cls`, populated once by the auth guard from the server-side session (never from request input, sec §3.1). BullMQ workers populate the same CLS store from trusted job payload fields written at enqueue time by already-scoped code, so repositories behave identically in HTTP and worker contexts.

```ts
// auth.guard.ts — the ONLY writer of tenant context in the HTTP path
this.cls.set('scope', {
  tenantId: session.tenantId,          // from server-side session store (sec §2)
  userId: session.userId,
  role: session.role,                  // 'user' | 'admin' — consumed by role guards
  edition: session.edition,            // 'kb' | 'ocr' — from the tenants record at session
                                       // creation; consumed by the EditionGuard (ADR-0009)
});
```

The CLS scope is the *complete* per-request identity contract: `{ tenantId, userId, role, edition }`. Downstream consumers (repositories here; `EditionGuard` in ADR-0009; role checks in ADR-0004) read only these fields — anything else a handler needs is data, not scope.

### Repository code shape (sec §3.1 "wrapper")

```ts
type Scope = {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  role: 'user' | 'admin';
  edition: 'kb' | 'ocr';
  ownerUserId?: Types.ObjectId;   // set for owner-scoped access paths (see below)
};

export abstract class ScopedRepository<T> {
  constructor(protected readonly model: Model<T>,
              protected readonly cls: ClsService) {}

  /** Throws MissingScopeError if no authenticated scope — fail closed. */
  protected scope(): FilterQuery<T> {
    const s = this.cls.get<Scope>('scope');
    if (!s?.tenantId) throw new MissingScopeError(this.model.modelName);
    return this.buildFilter(s);
  }

  /** Tenant-scoped by default; OwnerScopedRepository overrides. */
  protected buildFilter(s: Scope): FilterQuery<T> {
    return { tenantId: s.tenantId } as FilterQuery<T>;
  }

  find(filter: FilterQuery<T>)   { return this.model.find({ ...filter, ...this.scope() }); }
  findById(id: Types.ObjectId)   { return this.model.findOne({ _id: id, ...this.scope() }); } // miss ⇒ 404, sec §3.2
  updateOne(f: FilterQuery<T>, u: UpdateQuery<T>) { return this.model.updateOne({ ...f, ...this.scope() }, u); }
  deleteOne(f: FilterQuery<T>)   { return this.model.deleteOne({ ...f, ...this.scope() }); }
  aggregate(pipeline: PipelineStage[]) {
    return this.model.aggregate([{ $match: this.scope() }, ...pipeline]); // scope FIRST, always
  }
  // create() stamps tenantId from scope, ignoring any tenantId in the DTO (sec §3.1, §4.1)
  create(doc: Omit<T, 'tenantId'>) { return this.model.create({ ...doc, ...this.scope() }); }
}

/** Smart OCR edition: per-user directory isolation (PRD §15; sec §3.6). */
export abstract class OwnerScopedRepository<T> extends ScopedRepository<T> {
  protected buildFilter(s: Scope): FilterQuery<T> {
    if (!s.ownerUserId) throw new MissingScopeError(this.model.modelName);
    return { tenantId: s.tenantId, ownerUserId: s.ownerUserId } as FilterQuery<T>;
  }
}
```

`OwnerScopedRepository` is the *only* access path to two record classes whose confidentiality boundary is the **user**, not the tenant (sec §3.5):

1. **Smart-OCR file records** (`ocrFiles`) — structurally enforces "tenant admin cannot read users' file contents" (PRD §15): admin/metering endpoints use separate repositories over metering collections that never expose file content.
2. **Chat history** (`conversations`, `messages`, ADR-0002) — sec §3.5 equally forbids tenant admins reading users' private chat history; a tenant-level filter alone would not stop an admin who shares the `tenantId`. These collections carry `ownerUserId` and are readable only through this class.

### Backstop plugin (fail closed)

A global Mongoose plugin hooks `find*/count*/update*/delete*/aggregate/save` on every model whose schema is marked tenant-owned, and **throws** if the outgoing filter (or first pipeline stage) lacks `tenantId` equal to the CLS scope. It never injects — injection stays in the repository so the control is visible; the plugin only detects bypasses (including future code that dodges the lint rule).

### Cross-tenant / system escape hatch

Platform-admin and system jobs run inside an explicit `SystemScope.run(reason, fn)` wrapper that (a) sets a CLS flag the plugin honors, (b) writes an audit event with the reason (sec §8.1, PRD §5), and (c) is import-restricted by lint to named modules (`platform-admin/**`, `jobs/**`). The platform-admin portal is a separate auth realm anyway (sec §2), so tenant-user request paths can never reach it.

### CI guards — what fails the build

1. **Lint (structural):** `@nestjs/mongoose`'s `InjectModel` and any `mongoose` import are banned outside `src/**/repositories/**` via `no-restricted-imports` + a custom rule; `.aggregate(`, `.bulkWrite(`, `.collection` flagged outside `ScopedRepository` subclasses (implements sec §3.1's "lint rule").
2. **Runtime (fail closed):** the backstop plugin throws in every environment, including tests — an unscoped query cannot return data even if lint was evaded.
3. **Behavioral (CI suite):** the cross-tenant test suite runs on every PR (sec §10): a tenant-A session replays every API route with tenant-B identifiers and asserts 404 (sec §3.2, §3.3); a Smart-OCR variant replays user-A routes with user-B file IDs (sec §3.6). New routes are auto-enumerated from the NestJS route table so the suite cannot silently go stale.

## Consequences

- **Positive:** The system's most critical invariant (PRD §4 strict isolation) is enforced four ways with different failure modes; scope handling is centralized, which also serves the NoSQL-injection rules (sec §4.2 — no query built by merging raw input); Smart-OCR per-user isolation reuses the identical mechanism (sec §3.6) rather than a parallel one.
- **Negative / accepted risks:** All data access must go through repositories — one-off queries get slightly more ceremony; the backstop plugin's hook coverage must be re-audited on Mongoose major upgrades (mitigated: the CI suite is behavioral and version-independent). Aggregations that legitimately need cross-collection `$lookup` must join only tenant-owned collections and re-assert `tenantId` in the sub-pipeline — a documented repository-author rule, checked in code review (security-sensitive path per sec §10 CODEOWNERS).
- **Follow-ups:** Effective-permission filtering on top of tenant scope is ADR-0005; the retrieval query shape consuming both filters is ADR-0002; CODEOWNERS entry for `src/**/repositories/**` (sec §10); cross-tenant suite skeleton lands with the first repository in the implementation phase (plan Rule 3).
