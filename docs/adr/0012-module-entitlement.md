# ADR-0012: Module Entitlement Mechanism

**Status:** Accepted
**Date:** 2026-08-04
**Deciders:** Product owner (Ehud); drafted from the 2026-08-04 brainstorming session
**Sources:** `docs/superpowers/specs/2026-08-04-calendar-kanban-design.md`; ADR-0009 (edition gating — this ADR extends its G2 pattern)

## Context

Calendar, kanban, the deferred governance module, and LLM/chat itself are each separately-priced, opt-in modules per tenant — a new axis of configuration beyond ADR-0009's binary KB/OCR edition split. Need a mechanism with the same structural-enforcement property ADR-0009 chose for edition gating (G2): one guard, one decorator, not scattered `if` checks (rejected as G1 there for the same reason it's rejected here — LLM-cost and paid-module visibility are exactly the kind of check that needs a single enforcement point).

## Options Considered

### Option A: Reuse `featureToggles` string array with guard/decorator (chosen)

Reuse the existing `tenants.featureToggles: string[]` schema field (currently unused — no migration needed) to hold enabled module names: `'governance' | 'kanban' | 'calendar' | 'llm'`. A `@Module(name)` decorator (`libs/contracts/src/module.ts`) sets route metadata; `ModuleGuard` (`apps/api/src/common/module.guard.ts`) reads it and 404s when the tenant's `featureToggles` doesn't include the required name — structurally identical to `@Edition`/`EditionGuard`.

- **Pros:** Zero schema migration (field already exists); one guard, one decorator, same audited shape as the edition mechanism reviewers already understand; type-safe at call site via TypeScript union type.
- **Cons:** `featureToggles` is a loosely-typed `string[]` at the schema level rather than a closed enum — validation happens at the `@Module()` call site, not in the database schema. Module changes aren't instant (session-cache latency, same as edition today).

### Option B: Scattered `if` checks in each route handler

Inline conditional checks in route handlers: `if (!tenant.featureToggles.includes('calendar')) throw new ForbiddenException()`.

- **Pros:** No new infrastructure needed; decisions are locally visible per route.
- **Cons:** No structural guarantee — easy to forget the check, hard to audit coverage. Repeats the exact error that ADR-0009 identified for edition checks (scattered guards lack a single audited enforcement point). Creates risk of inconsistent behavior and allows paid-feature visibility to leak.

**Decision on the fork: Option A.** Modules are not free features; they are paid, separately-priced tenant options that must not leak into the UI or backend behavior even on a bug. The structural enforcement (one guard, one decorator, no `if` scattered) is the same reasoning that motivated ADR-0009's choice for edition.

## Decision

Reuse `tenants.featureToggles: string[]` to hold enabled module names. A `@Module(name)` decorator (`libs/contracts/src/module.ts`) sets route metadata; `ModuleGuard` (`apps/api/src/common/module.guard.ts`) reads it and 404s when the tenant's `featureToggles` doesn't include the required name — structurally identical to `@Edition`/`EditionGuard`.

Unlike edition, `@Module()` is **optional** per route (most routes need no module at all) — `ModuleGuard` allows any route without the decorator, mirroring `EditionGuard`'s existing `if (!requirement || requirement === 'both') return true` early return. No bootstrap-coverage assertion is added (there is no "every controller must declare a module" invariant — only edition has that).

Module flags are baked into the session record at login, exactly like `edition` already is (`auth.controller.ts`'s login handler → `SessionRecord` → `SessionAuthGuard` → CLS `Scope`). This means a module toggle takes effect on the tenant's users' next login/session refresh, not instantly — accepted, since `edition` already has this exact characteristic and it's never been a problem.

## Consequences

- **Positive:** Zero schema migration; one guard, one decorator, same audited shape as the edition mechanism reviewers already understand.
- **Negative/accepted:** Module changes aren't instant (session-cache latency, same as edition today); `featureToggles` is a loosely-typed `string[]` rather than a closed enum at the schema level — validated at the `@Module()` call site (TypeScript union type) instead.
- **Follow-ups:** The deferred governance module and LLM/chat gating both reuse this mechanism unchanged when built.
