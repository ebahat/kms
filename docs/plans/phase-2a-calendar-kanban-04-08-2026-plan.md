# Phase 2A Implementation Plan — Calendar & Task Management

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-08-04 · **Status:** NOT STARTED
**Scope:** `docs/plans/implementation-phases-11-07-2026-plan.md` Phase 2A
**Sources:** `docs/superpowers/specs/2026-08-04-calendar-kanban-design.md` (the approved design — read it first, this plan doesn't repeat its rationale), ADR-0001 (tenant scoping), ADR-0002 (`auditEvents`), ADR-0005 (folder/group permissions), ADR-0006 (storage), ADR-0007 (hosting/egress), ADR-0009 (edition gating — the pattern this plan's module-entitlement mechanism mirrors)

**Goal:** Ship calendar events and a kanban board, scoped one-per-group, as separately-priced opt-in modules, plus opt-in email notifications for file/task lifecycle changes and their audit-trail coverage — without breaking anything in the already-shipped Phase 2.1–2.5.

**Architecture:** Two new tenant-scoped collections (`events`, `tasks`) with binary group-membership authorization (no folder-style tiers); a new module-entitlement mechanism that mirrors ADR-0009's `@Edition`/`EditionGuard` pair exactly (`@Module`/`ModuleGuard`, baked into the session at login the same way `edition` already is); a small `NotificationProvider` interface living in `apps/api` (same shallow-adapter pattern as `StorageProvider`, not a new shared lib); retrofitted hook calls into the existing `DocumentsController` upload/delete methods for file-lifecycle notifications and (a newly-discovered gap) upload audit events.

**Tech Stack:** NestJS, Mongoose (`libs/data`'s `ScopedRepository`), `nestjs-cls` for the CLS scope, Jest for tests. New external dependency: an email API (Resend or Postmark — picked in Task 2's ADR).

## Global Constraints

- Every new Mongoose schema uses `tenantScopeBackstopPlugin` and is only ever touched through a `ScopedRepository` subclass in `libs/data` — direct model injection outside `libs/data` is lint-banned (ADR-0001).
- Every new/modified route returns **404, never 403**, on any authorization miss (sec §3.2 — matches `EditionGuard`, `DocumentsPermissionsService`, and every existing controller).
- No live MongoDB/Redis/GCS in this environment — tests run against `mongodb-memory-server`/`ioredis-mock`/fakes, same as every prior phase item. Do not write a step that assumes a live database.
- `pnpm turbo run build lint test:unit` (and `test:integration` where applicable) must stay green across **all** workspace packages after every task, not just the ones touched — Task 9 touches already-shipped Phase 2.3/2.5 code and must not regress its existing tests.
- Follow the existing repo's ADR numbering: **ADR-0011 is already reserved** (cited by name in ADR-0005's amendment for the not-yet-written direct-sharing ADR) — this plan's new ADRs are **ADR-0012** (module entitlement) and **ADR-0013** (email provider). Do not use 0011.

---

## Sequencing

Tasks build on each other in this order — do not reorder:

1. **Task 1** — ADR-0012: module entitlement mechanism (doc only)
2. **Task 2** — ADR-0013: email provider selection (doc only)
3. **Task 3** — Module entitlement plumbing (`@Module`/`ModuleGuard`, session/scope wiring)
4. **Task 4** — `events` collection + calendar controller (+ invite email, + audit)
5. **Task 5** — `tasks` collection + kanban controller + merged calendar read (+ assignment email, + audit)
6. **Task 6** — `NotificationProvider` interface + Fake + real adapter
7. **Task 7** — `userNotificationPreferences` collection + preferences controller
8. **Task 8** — Preference-gated triggers: retrofit into `DocumentsController` (upload/delete) and the Task 4/5 controllers; fixes a discovered gap (upload has no audit event today)
9. **Task 9** — Integration/cross-tenant coverage for all new routes
10. **Task 10** — UI spec addendum (doc only — no UI code in this plan, matches how Phase 2's own 2.6 UI was sequenced after 2.1–2.5 landed)

## Key design decisions (grounded in the real current code, not assumed)

- **`tenants.featureToggles: string[]` already exists** (`libs/data/src/models/tenant.schema.ts:26`) and is currently written as `[]` everywhere (seed, portal-api tenant creation, test fixtures) but **read nowhere** — zero consumers today. Task 3 reuses this exact field for module flags (`'calendar' | 'kanban' | 'governance' | 'llm'`) instead of adding a new one. No schema migration needed.
- **Module flags are baked into the session at login, exactly like `edition` is today** — `apps/api/src/auth/auth.controller.ts:105-117` fetches the tenant, computes `edition`, and stores it directly in the Redis session record (`libs/auth/src/session.ts`'s `SessionRecord`); `SessionAuthGuard` (`apps/api/src/auth/session-auth.guard.ts:49`) reads it back into the CLS `Scope` on every request. This plan follows the identical path for `featureToggles`, which means **toggling a tenant's modules takes effect on next login/session refresh, not instantly** — the same latency `edition` changes already have today. Not a new limitation this plan introduces; flagged here so it isn't mistaken for a bug later.
- **`NotificationProvider` lives in `apps/api/src/notifications/`, not a new `libs/` package** — mirrors the Phase 2 plan's own reasoning for `StorageProvider` (`apps/api/src/documents/storage/`): no ADR mandates a shared lib, and `libs/ai-providers` is still an empty 3-line stub (Phase 4 territory), so there's no existing adapter pattern to join. Extract later only if something besides `apps/api` needs it (YAGNI).
- **`GroupsRepository.findForMember(userId)` already exists** (`libs/data/src/repositories/groups.repository.ts:19`) and returns the groups a user belongs to — reused directly for both event/task authorization and "all" notification-preference scope resolution. No new principal-resolution code needed.
- **`AuditEventsRepository.record({action, targetId, metadata})` already exists** and auto-fills `actorUserId`/`tenantId`/`ts` from the CLS scope (`libs/data/src/repositories/audit-events.repository.ts:22`) — new event types are just new call sites, not new plumbing.
- **Discovered gap:** `DocumentsController.upload()` (`apps/api/src/documents/documents.controller.ts:246-281`) records **no audit event today**, despite PRD §12 listing "upload" in its coverage. `download()`, `delete()`, `restore()`, and `purgeEarly()` all call `auditEvents.record(...)`; `upload()`/`uploadNewVersion()` don't. Task 8 fixes this while it's already touching that method for the notification hook — small, clearly in-scope, not silently expanding beyond what's needed.

## Exit criteria

A group member can create a calendar event (an invite email goes out to the rest of the group) and a kanban task (an assignment email goes out to the assignee); a tenant without the `calendar`/`kanban` module enabled gets 404 on those routes; a user can opt into "notify me about all files added to groups I'm in" and receives an email when someone else uploads a file to a folder one of their groups can read, but not for their own uploads; every new action type appears in `auditEvents`; Phase 2.3/2.5's existing test suites are still 100% green.

---

### Task 1: ADR-0012 — Module entitlement mechanism

**Files:**
- Create: `docs/adr/0012-module-entitlement.md`
- Modify: `docs/architecture/system-overview.md` (add ADR-0012 to the ADR index table, matching how ADR-0010 was added)

**Interfaces:**
- Produces: the decision that later tasks implement — `tenants.featureToggles: string[]` holds module names, baked into the session record at login (same pattern as `edition`), read by a new `ModuleGuard`/`@Module()` decorator pair.

- [ ] **Step 1: Write the ADR**

Use `docs/adr/template.md`'s structure (same as ADR-0009/0010). Content to include, grounded in what Tasks 3+ will build:

```markdown
# ADR-0012: Module Entitlement Mechanism

**Status:** Accepted (2026-08-04)
**Deciders:** Product owner (Ehud); drafted from the 2026-08-04 brainstorming session
**Sources:** `docs/superpowers/specs/2026-08-04-calendar-kanban-design.md`; ADR-0009 (edition gating — this ADR extends its G2 pattern)

## Context

Calendar, kanban, the deferred governance module, and LLM/chat itself are each
separately-priced, opt-in modules per tenant — a new axis of configuration
beyond ADR-0009's binary KB/OCR edition split. Need a mechanism with the same
structural-enforcement property ADR-0009 chose for edition gating (G2): one
guard, one decorator, not scattered `if` checks (rejected as G1 there for the
same reason it's rejected here — LLM-cost and paid-module visibility are
exactly the kind of check that needs a single enforcement point).

## Decision

Reuse `tenants.featureToggles: string[]` (already exists on the schema,
currently unused — no migration needed) to hold enabled module names:
`'governance' | 'kanban' | 'calendar' | 'llm'`. A `@Module(name)` decorator
(`libs/contracts/src/module.ts`) sets route metadata; `ModuleGuard`
(`apps/api/src/common/module.guard.ts`) reads it and 404s when the tenant's
`featureToggles` doesn't include the required name — structurally identical
to `@Edition`/`EditionGuard`.

Unlike edition, `@Module()` is **optional** per route (most routes need no
module at all) — `ModuleGuard` allows any route without the decorator,
mirroring `EditionGuard`'s existing `if (!requirement || requirement ===
'both') return true` early return. No bootstrap-coverage assertion is added
(there is no "every controller must declare a module" invariant — only
edition has that).

Module flags are baked into the session record at login, exactly like
`edition` already is (`auth.controller.ts`'s login handler → `SessionRecord`
→ `SessionAuthGuard` → CLS `Scope`). This means a module toggle takes effect
on the tenant's users' next login/session refresh, not instantly — accepted,
since `edition` already has this exact characteristic and it's never been a
problem.

## Consequences

- Positive: zero schema migration; one guard, one decorator, same audited
  shape as the edition mechanism reviewers already understand.
- Negative/accepted: module changes aren't instant (session-cache latency,
  same as edition today); `featureToggles` is a loosely-typed `string[]`
  rather than a closed enum at the schema level — validated at the
  `@Module()` call site (TypeScript union type) instead.
- Follow-ups: the deferred governance module and LLM/chat gating both reuse
  this mechanism unchanged when built.
```

- [ ] **Step 2: Add the ADR to the system-overview index**

In `docs/architecture/system-overview.md`, find the ADR index table (same place ADR-0010 was added) and add a row for ADR-0012.

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0012-module-entitlement.md docs/architecture/system-overview.md
git commit -m "docs: ADR-0012 module entitlement mechanism"
```

---

### Task 2: ADR-0013 — Email provider selection

**Files:**
- Create: `docs/adr/0013-email-provider.md`
- Modify: `docs/architecture/system-overview.md` (ADR index)

**Interfaces:**
- Produces: the concrete provider name and API shape Task 6's `NotificationProvider` adapter implements.

- [ ] **Step 1: Write the ADR**

Compare Resend vs. Postmark against design-review finding 11's constraint (EU processing, DPA, named egress — same requirement ADR-0007 already applies to OCR/AI providers). Decide one. Include: API base URL (for ADR-0007's egress allowlist), auth mechanism (API key), and confirmation a DPA is available. Record the decision as **Resend** unless research at write-time turns up a reason to prefer Postmark — both satisfy the constraint; Resend's API is a single `POST https://api.resend.com/emails` call with a bearer API key, which is the simplest shape to adapt.

- [ ] **Step 2: Add to system-overview ADR index; commit**

```bash
git add docs/adr/0013-email-provider.md docs/architecture/system-overview.md
git commit -m "docs: ADR-0013 email provider selection"
```

---

### Task 3: Module entitlement plumbing

**Files:**
- Modify: `libs/data/src/scope.ts` (add `featureToggles` to `Scope` and `scopeFromIds`)
- Modify: `libs/auth/src/session.ts` (add `featureToggles?: string[]` to `SessionRecord`)
- Modify: `apps/api/src/auth/session-auth.guard.ts` (populate CLS scope)
- Modify: `apps/api/src/auth/auth.controller.ts` (fetch + pass through at login)
- Create: `libs/contracts/src/module.ts`
- Modify: `libs/contracts/src/index.ts` (export it — check the existing barrel for the exact pattern used for `edition.ts`)
- Create: `apps/api/src/common/module.guard.ts`
- Create: `apps/api/src/common/module.guard.spec.ts`
- Modify: `apps/api/src/app.module.ts` (register `ModuleGuard` as `APP_GUARD`)

**Interfaces:**
- Produces: `Scope.featureToggles: string[]`; `@Module(name: 'calendar'|'kanban'|'governance'|'llm')` decorator; `ModuleGuard` (NestJS `CanActivate`).
- Consumes: `EDITION_METADATA_KEY` pattern from `libs/contracts/src/edition.ts` (mirrored, not imported — module and edition are independent concerns).

- [ ] **Step 1: Extend `Scope` and `scopeFromIds`**

In `libs/data/src/scope.ts`, add to the `Scope` type and `scopeFromIds` params/return, right next to `edition`:

```typescript
export type Scope = {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  role: 'user' | 'admin';
  edition: 'kb' | 'ocr';
  featureToggles: string[];
  ownerUserId?: Types.ObjectId;
};

export function scopeFromIds(data: {
  userId: string;
  tenantId: string;
  role: Scope['role'];
  edition: Scope['edition'];
  featureToggles?: string[];
  ownerUserId?: string;
}): Scope {
  return {
    userId: new Types.ObjectId(data.userId),
    tenantId: new Types.ObjectId(data.tenantId),
    role: data.role,
    edition: data.edition,
    featureToggles: data.featureToggles ?? [],
    ownerUserId: data.ownerUserId ? new Types.ObjectId(data.ownerUserId) : undefined,
  };
}
```

- [ ] **Step 2: Run existing `libs/data` unit tests to confirm nothing broke**

Run: `pnpm --filter @kms/data test:unit`
Expected: PASS — `scopeFromIds` gains an optional param, no existing call site breaks.

- [ ] **Step 3: Extend `SessionRecord`**

In `libs/auth/src/session.ts`:

```typescript
export type SessionRecord = {
  userId: string;
  tenantId?: string;
  role: 'user' | 'admin';
  edition?: 'kb' | 'ocr';
  featureToggles?: string[];
  createdAt: string;
  lastSeenAt: string;
  mfaVerified: boolean;
  tosVersion?: string;
};
```

- [ ] **Step 4: Populate the CLS scope in `SessionAuthGuard`**

In `apps/api/src/auth/session-auth.guard.ts`, the `scopeFromIds` call at line ~45:

```typescript
const scope = scopeFromIds({
  userId: record.userId,
  tenantId: record.tenantId,
  role: record.role,
  edition: record.edition ?? 'kb',
  featureToggles: record.featureToggles ?? [],
});
```

- [ ] **Step 5: Populate the session record at login**

In `apps/api/src/auth/auth.controller.ts`, around line 105-117 (the login handler):

```typescript
const tenant = await this.tenants.findById(user!.tenantId);
const edition = tenant?.edition ?? 'kb';
const featureToggles = tenant?.featureToggles ?? [];
this.setUserScope(user!._id, user!.tenantId, user!.role, edition, featureToggles);
await this.users.updateOne({ _id: user!._id }, { $set: { lastLoginAt: new Date() } });

const sessionId = await this.sessions.create('tenant', {
  userId: user!._id.toString(),
  tenantId: user!.tenantId.toString(),
  role: user!.role,
  edition,
  featureToggles,
  mfaVerified: false,
  tosVersion: user!.tosAcceptedVersion,
});
```

And extend the `setUserScope` private method (around line 274) to accept and forward `featureToggles`, defaulting to `[]`.

- [ ] **Step 6: Write `libs/contracts/src/module.ts`** (mirrors `edition.ts` exactly)

```typescript
import { SetMetadata } from '@nestjs/common';

export type ModuleName = 'governance' | 'kanban' | 'calendar' | 'llm';

export const MODULE_METADATA_KEY = 'kms:module' as const;

/**
 * Declares which opt-in module a route requires (ADR-0012). Unlike @Edition,
 * this is optional — most routes need no module at all. ModuleGuard
 * (apps/api/src/common/module.guard.ts) reads this and returns 404 — never
 * 403 — when the tenant's featureToggles doesn't include it.
 */
export const Module = (name: ModuleName) => SetMetadata(MODULE_METADATA_KEY, name);
```

Add `export * from './module';` to `libs/contracts/src/index.ts` next to the `edition` export.

- [ ] **Step 7: Write the failing `ModuleGuard` test**

`apps/api/src/common/module.guard.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { SCOPE_CLS_KEY } from '@kms/data';
import { MODULE_METADATA_KEY } from '@kms/contracts';
import { ModuleGuard } from './module.guard';

function makeContext(scope: { featureToggles: string[] } | undefined) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

describe('ModuleGuard', () => {
  let guard: ModuleGuard;
  let cls: ClsService;
  let reflector: Reflector;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ModuleGuard, Reflector, { provide: ClsService, useValue: { get: jest.fn() } }],
    }).compile();
    guard = moduleRef.get(ModuleGuard);
    cls = moduleRef.get(ClsService);
    reflector = moduleRef.get(Reflector);
  });

  it('allows a route with no @Module() requirement', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(makeContext(undefined))).toBe(true);
  });

  it('allows a tenant whose featureToggles includes the required module', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('calendar');
    jest.spyOn(cls, 'get').mockReturnValue({ featureToggles: ['calendar'] });
    expect(guard.canActivate(makeContext(undefined))).toBe(true);
  });

  it('404s a tenant whose featureToggles is missing the required module', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('kanban');
    jest.spyOn(cls, 'get').mockReturnValue({ featureToggles: ['calendar'] });
    expect(() => guard.canActivate(makeContext(undefined))).toThrow('Not Found');
  });
});
```

- [ ] **Step 8: Run it, confirm it fails** (module.guard.ts doesn't exist yet)

Run: `pnpm --filter api test:unit -- module.guard.spec`
Expected: FAIL — cannot find module `./module.guard`.

- [ ] **Step 9: Write `ModuleGuard`** (mirrors `EditionGuard` exactly)

```typescript
import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { Scope, SCOPE_CLS_KEY } from '@kms/data';
import { MODULE_METADATA_KEY, ModuleName } from '@kms/contracts';

/**
 * ADR-0012: a route with no @Module() requirement is always allowed. A route
 * that declares one 404s (never 403, sec §3.2) if the tenant's
 * featureToggles doesn't include it.
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requirement = this.reflector.getAllAndOverride<ModuleName | undefined>(MODULE_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requirement) return true;

    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope) return true; // the auth guard runs first and rejects unauthenticated requests

    if (!scope.featureToggles.includes(requirement)) {
      throw new NotFoundException();
    }
    return true;
  }
}
```

- [ ] **Step 10: Run the test again, confirm it passes**

Run: `pnpm --filter api test:unit -- module.guard.spec`
Expected: PASS (all 3 cases).

- [ ] **Step 11: Register the guard in `AppModule`**

In `apps/api/src/app.module.ts`, import `ModuleGuard` and add it to the `APP_GUARD` providers array, after `EditionGuard`:

```typescript
{ provide: APP_GUARD, useClass: EditionGuard },
{ provide: APP_GUARD, useClass: ModuleGuard },
```

- [ ] **Step 12: Full workspace check, then commit**

Run: `pnpm turbo run build lint test:unit`
Expected: all green, including previously-passing packages.

```bash
git add libs/data/src/scope.ts libs/auth/src/session.ts apps/api/src/auth/session-auth.guard.ts \
  apps/api/src/auth/auth.controller.ts libs/contracts/src/module.ts libs/contracts/src/index.ts \
  apps/api/src/common/module.guard.ts apps/api/src/common/module.guard.spec.ts apps/api/src/app.module.ts
git commit -m "feat: module-entitlement mechanism (ADR-0012) — @Module/ModuleGuard"
```

---

### Task 4: `events` collection + calendar controller

**Files:**
- Create: `libs/data/src/models/event.schema.ts`
- Create: `libs/data/src/repositories/events.repository.ts`
- Modify: `libs/data/src/index.ts` (export both)
- Create: `apps/api/src/groups/groups-membership.service.ts` (shared by Tasks 4 and 5 — see Step 3)
- Create: `apps/api/src/groups/events.controller.ts`
- Create: `apps/api/src/groups/events.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts` (register schema, repository, service, controller)

**Interfaces:**
- Consumes: `ScopedRepository<T>` (`create`, `find`, `findById`, `updateOne`, `deleteOne` — `libs/data/src/scoped-repository.ts`), `GroupsRepository.findForMember(userId)` (`libs/data/src/repositories/groups.repository.ts:19`), `AuditEventsRepository.record({action, targetId, metadata})`, `@Module('calendar')` from Task 3.
- Produces: `EventsRepository` (used by Task 5's merged calendar-read route), `GroupsMembershipService.isMember(groupId, userId): Promise<boolean>` (used by Task 5's `TasksController` too).

- [ ] **Step 1: Write the failing schema test**

`libs/data/src/models/event.schema.spec.ts` — follow the exact pattern of an existing schema spec (check `libs/data/src/models/group.schema.spec.ts` if one exists, otherwise `document.schema.spec.ts`) for how this repo asserts required fields via `mongodb-memory-server`. At minimum:

```typescript
it('rejects a save missing groupId', async () => {
  const doc = new EventModel({ tenantId: new Types.ObjectId(), title: 'x', startAt: new Date(), endAt: new Date() });
  await expect(doc.validate()).rejects.toThrow();
});
```

- [ ] **Step 2: Run it, confirm it fails** (schema doesn't exist)

- [ ] **Step 3: Write `event.schema.ts`**

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

/** Calendar events, one calendar per group (Phase 2A design, decision 1). */
@Schema({ collection: 'events', timestamps: true })
export class Event {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  groupId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ required: true })
  startAt!: Date;

  @Prop({ required: true })
  endAt!: Date;

  @Prop({ trim: true })
  location?: string;

  @Prop({ required: true, type: Types.ObjectId })
  createdBy!: Types.ObjectId;
}

export type EventDocument = HydratedDocument<Event> & { _id: Types.ObjectId };
export const EventSchema = SchemaFactory.createForClass(Event);
EventSchema.index({ tenantId: 1, groupId: 1, startAt: 1 });
EventSchema.plugin(tenantScopeBackstopPlugin);
```

- [ ] **Step 4: Run the schema test, confirm it passes**

- [ ] **Step 5: Write `EventsRepository`**

```typescript
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model, Types } from 'mongoose';
import { ScopedRepository } from '../scoped-repository';
import { Event, EventDocument } from '../models/event.schema';

@Injectable()
export class EventsRepository extends ScopedRepository<Event> {
  constructor(@InjectModel(Event.name) model: Model<Event>, cls: ClsService) {
    super(model, cls);
  }

  findForGroup(groupId: Types.ObjectId): Promise<EventDocument[]> {
    return this.find({ groupId }) as unknown as Promise<EventDocument[]>;
  }

  /** Used by Task 5's merged calendar-read route. */
  findForGroupInRange(groupId: Types.ObjectId, from: Date, to: Date): Promise<EventDocument[]> {
    return this.find({ groupId, startAt: { $lte: to }, endAt: { $gte: from } }) as unknown as Promise<EventDocument[]>;
  }
}
```

Add both exports to `libs/data/src/index.ts`:
```typescript
export * from './models/event.schema';
export * from './repositories/events.repository';
```

- [ ] **Step 6: Write `GroupsMembershipService`** (authorization — decision 2: any member, admin bypass mirrors `DocumentsPermissionsService`'s existing precedent)

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { GroupsRepository, MissingScopeError, SCOPE_CLS_KEY, Scope, toObjectId } from '@kms/data';

@Injectable()
export class GroupsMembershipService {
  constructor(
    private readonly cls: ClsService,
    private readonly groups: GroupsRepository,
  ) {}

  /** Any group member may read/create/edit/delete events and tasks in that group (Phase 2A design, decision 2). Tenant admins bypass, matching the existing PRD §7 precedent in DocumentsPermissionsService. */
  async isMember(groupId: string): Promise<boolean> {
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope) throw new MissingScopeError('GroupsMembershipService');

    const group = await this.groups.findById(toObjectId(groupId));
    if (!group) return false;
    if (scope.role === 'admin') return true;

    return group.memberUserIds.some((id) => id.equals(scope.userId));
  }
}
```

- [ ] **Step 7: Write failing controller tests** (`events.controller.spec.ts`) — cover: member can create, non-member gets 404, cross-tenant groupId gets 404, module-disabled tenant gets 404 (mock `GroupsMembershipService` and `ModuleGuard`'s upstream scope). Follow the existing `documents.controller.spec.ts` (if present) or `tenant-users-admin.controller.spec.ts` for this repo's controller-test setup pattern (Test.createTestingModule with mocked repositories).

- [ ] **Step 8: Run, confirm failure**

- [ ] **Step 9: Write `EventsController`**

```typescript
import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Module } from '@kms/contracts';
import { AuditEventsRepository, EventsRepository, SCOPE_CLS_KEY, Scope, toObjectId, newObjectId } from '@kms/data';
import { GroupsMembershipService } from './groups-membership.service';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service'; // Task 6/8

@Controller('groups/:groupId/events')
@Module('calendar')
export class EventsController {
  constructor(
    private readonly cls: ClsService,
    private readonly events: EventsRepository,
    private readonly membership: GroupsMembershipService,
    private readonly auditEvents: AuditEventsRepository,
    private readonly notifications: NotificationDispatchService,
  ) {}

  @Get()
  async list(@Param('groupId') groupId: string) {
    if (!(await this.membership.isMember(groupId))) throw new NotFoundException();
    return this.events.findForGroup(toObjectId(groupId));
  }

  @Post()
  @HttpCode(201)
  async create(@Param('groupId') groupId: string, @Body() body: { title: string; description?: string; startAt: string; endAt: string; location?: string }) {
    if (!(await this.membership.isMember(groupId))) throw new NotFoundException();

    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY)!;
    const event = await this.events.create({
      groupId: toObjectId(groupId),
      title: body.title,
      description: body.description,
      startAt: new Date(body.startAt),
      endAt: new Date(body.endAt),
      location: body.location,
      createdBy: scope.userId,
    });

    await this.auditEvents.record({ action: 'calendar.event.created', targetId: event._id, metadata: { groupId } });
    await this.notifications.notifyEventCreated(event); // always-on invite email, decision 6 — not preference-gated

    return event;
  }

  @Delete(':eventId')
  @HttpCode(200)
  async remove(@Param('groupId') groupId: string, @Param('eventId') eventId: string) {
    if (!(await this.membership.isMember(groupId))) throw new NotFoundException();

    const id = toObjectId(eventId);
    const existing = await this.events.findById(id);
    if (!existing || !existing.groupId.equals(toObjectId(groupId))) throw new NotFoundException();

    await this.events.deleteOne({ _id: id });
    await this.auditEvents.record({ action: 'calendar.event.deleted', targetId: id, metadata: { groupId } });

    return { deleted: true };
  }
}
```

(A `PATCH` handler for edits follows the same shape — omitted here for brevity but required before this task is done; write it with the same membership check + audit event, no notification trigger per the design doc, which only specifies create/delete triggers.)

- [ ] **Step 10: Run controller tests, confirm pass**

- [ ] **Step 11: Register in `AppModule`**

Add `Event`/`EventSchema` to `MongooseModule.forFeature`, `EventsRepository`/`GroupsMembershipService` to `providers`, `EventsController` to `controllers`.

- [ ] **Step 12: Full workspace check, commit**

```bash
git add libs/data/src/models/event.schema.ts libs/data/src/models/event.schema.spec.ts \
  libs/data/src/repositories/events.repository.ts libs/data/src/index.ts \
  apps/api/src/groups/groups-membership.service.ts apps/api/src/groups/events.controller.ts \
  apps/api/src/groups/events.controller.spec.ts apps/api/src/app.module.ts
git commit -m "feat: calendar events (Phase 2A) — events collection, controller, invite email hook"
```

---

### Task 5: `tasks` collection + kanban controller + merged calendar read

**Files:**
- Create: `libs/data/src/models/task.schema.ts`
- Create: `libs/data/src/repositories/tasks.repository.ts`
- Modify: `libs/data/src/index.ts`
- Create: `apps/api/src/groups/tasks.controller.ts`
- Create: `apps/api/src/groups/tasks.controller.spec.ts`
- Create: `apps/api/src/groups/calendar.controller.ts` (the merged `GET /groups/:groupId/calendar` read)
- Create: `apps/api/src/groups/calendar.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `GroupsMembershipService.isMember` (Task 4), `EventsRepository.findForGroupInRange` (Task 4), `AuditEventsRepository`, `@Module('kanban')`/`@Module('calendar')`.
- Produces: `TasksRepository.findForGroup`, `.findWithDueDateInRange` (consumed by `CalendarController`).

- [ ] **Step 1: Write the failing schema test, then `task.schema.ts`** — same TDD shape as Task 4 Step 1-4.

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

export type TaskColumn = 'todo' | 'in_progress' | 'done';

/** Kanban tasks, one board per group, fixed 3 columns (Phase 2A design, decision 4). */
@Schema({ collection: 'tasks', timestamps: true })
export class Task {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  groupId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ required: true, enum: ['todo', 'in_progress', 'done'], default: 'todo' })
  column!: TaskColumn;

  @Prop({ type: Types.ObjectId })
  assigneeUserId?: Types.ObjectId;

  @Prop()
  dueDate?: Date;

  @Prop({ required: true, type: Types.ObjectId })
  createdBy!: Types.ObjectId;
}

export type TaskDocument = HydratedDocument<Task> & { _id: Types.ObjectId };
export const TaskSchema = SchemaFactory.createForClass(Task);
TaskSchema.index({ tenantId: 1, groupId: 1, column: 1 });
TaskSchema.plugin(tenantScopeBackstopPlugin);
```

- [ ] **Step 2: Write `TasksRepository`**

```typescript
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model, Types } from 'mongoose';
import { ScopedRepository } from '../scoped-repository';
import { Task, TaskDocument } from '../models/task.schema';

@Injectable()
export class TasksRepository extends ScopedRepository<Task> {
  constructor(@InjectModel(Task.name) model: Model<Task>, cls: ClsService) {
    super(model, cls);
  }

  findForGroup(groupId: Types.ObjectId): Promise<TaskDocument[]> {
    return this.find({ groupId }) as unknown as Promise<TaskDocument[]>;
  }

  /** Used by CalendarController's merged read (design doc: "task due dates surface on the calendar"). */
  findWithDueDateInRange(groupId: Types.ObjectId, from: Date, to: Date): Promise<TaskDocument[]> {
    return this.find({ groupId, dueDate: { $gte: from, $lte: to } }) as unknown as Promise<TaskDocument[]>;
  }
}
```

Export both from `libs/data/src/index.ts`.

- [ ] **Step 3: Write failing `TasksController` tests, then the controller** — same CRUD shape as `EventsController` (Task 4 Step 9), plus:
  - `PATCH :taskId` handles both column moves and reassignment (design doc's API-surface note). On reassignment, call `notifications.notifyTaskAssigned(task)` (always-on, decision 6) and `auditEvents.record({action: 'kanban.task.statusChanged', ...})` when `column` changes.
  - `POST` fires `auditEvents.record({action: 'kanban.task.created', ...})`.
  - `DELETE` fires `auditEvents.record({action: 'kanban.task.deleted', ...})`.

```typescript
@Controller('groups/:groupId/tasks')
@Module('kanban')
export class TasksController {
  constructor(
    private readonly cls: ClsService,
    private readonly tasks: TasksRepository,
    private readonly membership: GroupsMembershipService,
    private readonly auditEvents: AuditEventsRepository,
    private readonly notifications: NotificationDispatchService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Param('groupId') groupId: string, @Body() body: { title: string; description?: string; assigneeUserId?: string; dueDate?: string }) {
    if (!(await this.membership.isMember(groupId))) throw new NotFoundException();

    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY)!;
    const task = await this.tasks.create({
      groupId: toObjectId(groupId),
      title: body.title,
      description: body.description,
      column: 'todo',
      assigneeUserId: body.assigneeUserId ? toObjectId(body.assigneeUserId) : undefined,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      createdBy: scope.userId,
    });

    await this.auditEvents.record({ action: 'kanban.task.created', targetId: task._id, metadata: { groupId } });
    if (task.assigneeUserId) await this.notifications.notifyTaskAssigned(task);

    return task;
  }

  @Patch(':taskId')
  async update(@Param('groupId') groupId: string, @Param('taskId') taskId: string, @Body() body: { column?: TaskColumn; assigneeUserId?: string }) {
    if (!(await this.membership.isMember(groupId))) throw new NotFoundException();

    const id = toObjectId(taskId);
    const existing = await this.tasks.findById(id);
    if (!existing || !existing.groupId.equals(toObjectId(groupId))) throw new NotFoundException();

    const update: Record<string, unknown> = {};
    if (body.column && body.column !== existing.column) update.column = body.column;
    if (body.assigneeUserId) update.assigneeUserId = toObjectId(body.assigneeUserId);
    await this.tasks.updateOne({ _id: id }, { $set: update });

    if (update.column) await this.auditEvents.record({ action: 'kanban.task.statusChanged', targetId: id, metadata: { groupId, from: existing.column, to: update.column } });
    if (update.assigneeUserId) {
      const updated = await this.tasks.findById(id);
      await this.notifications.notifyTaskAssigned(updated!);
    }

    return this.tasks.findById(id);
  }

  @Delete(':taskId')
  @HttpCode(200)
  async remove(@Param('groupId') groupId: string, @Param('taskId') taskId: string) {
    if (!(await this.membership.isMember(groupId))) throw new NotFoundException();

    const id = toObjectId(taskId);
    const existing = await this.tasks.findById(id);
    if (!existing || !existing.groupId.equals(toObjectId(groupId))) throw new NotFoundException();

    await this.tasks.deleteOne({ _id: id });
    await this.auditEvents.record({ action: 'kanban.task.deleted', targetId: id, metadata: { groupId } });

    return { deleted: true };
  }
}
```

- [ ] **Step 4: Write `CalendarController`** (merged read — design doc: requires only `@Module('calendar')`, degrades gracefully when `kanban` is off)

```typescript
@Controller('groups/:groupId/calendar')
@Module('calendar')
export class CalendarController {
  constructor(
    private readonly cls: ClsService,
    private readonly events: EventsRepository,
    private readonly tasks: TasksRepository,
    private readonly membership: GroupsMembershipService,
  ) {}

  @Get()
  async list(@Param('groupId') groupId: string, @Query('from') from: string, @Query('to') to: string) {
    if (!(await this.membership.isMember(groupId))) throw new NotFoundException();

    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY)!;
    const range = { from: new Date(from), to: new Date(to) };
    const events = await this.events.findForGroupInRange(toObjectId(groupId), range.from, range.to);

    // Degrades gracefully, doesn't 404, when kanban is off (design doc decision) — not a ModuleGuard check, a direct featureToggles read.
    const tasks = scope.featureToggles.includes('kanban') ? await this.tasks.findWithDueDateInRange(toObjectId(groupId), range.from, range.to) : [];

    return { events, tasks };
  }
}
```

- [ ] **Step 5: Run all new tests, confirm pass**

- [ ] **Step 6: Register in `AppModule`; full workspace check; commit**

```bash
git add libs/data/src/models/task.schema.ts libs/data/src/models/task.schema.spec.ts \
  libs/data/src/repositories/tasks.repository.ts libs/data/src/index.ts \
  apps/api/src/groups/tasks.controller.ts apps/api/src/groups/tasks.controller.spec.ts \
  apps/api/src/groups/calendar.controller.ts apps/api/src/groups/calendar.controller.spec.ts \
  apps/api/src/app.module.ts
git commit -m "feat: kanban tasks + merged calendar read (Phase 2A)"
```

---

### Task 6: `NotificationProvider` — interface, Fake, real adapter

**Files:**
- Create: `apps/api/src/notifications/notification-provider.ts`
- Create: `apps/api/src/notifications/fake-notification-provider.ts`
- Create: `apps/api/src/notifications/resend-notification-provider.ts` (name depends on Task 2's ADR-0013 pick)
- Create: `apps/api/src/notifications/notifications.providers.ts`
- Create: `apps/api/src/notifications/notification-dispatch.service.ts` (stub in this task — `notifyEventCreated`/`notifyTaskAssigned` only; preference-gated methods land in Task 8)
- Create matching `.spec.ts` files
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces: `NotificationProvider.sendEmail({to, subject, body}): Promise<void>`; `NotificationDispatchService.notifyEventCreated(event)`, `.notifyTaskAssigned(task)`.
- Consumes: `GroupsRepository.findForMember`/`findById` for resolving "every other group member."

- [ ] **Step 1: Write `NotificationProvider` interface** (mirrors `StorageProvider`'s shape in `apps/api/src/documents/storage/storage-provider.ts`)

```typescript
export type SendEmailArgs = { to: string; subject: string; body: string };

export interface NotificationProvider {
  sendEmail(args: SendEmailArgs): Promise<void>;
}
```

- [ ] **Step 2: Write `FakeNotificationProvider`**

```typescript
import { Injectable } from '@nestjs/common';
import { NotificationProvider, SendEmailArgs } from './notification-provider';

@Injectable()
export class FakeNotificationProvider implements NotificationProvider {
  readonly sent: SendEmailArgs[] = [];

  async sendEmail(args: SendEmailArgs): Promise<void> {
    this.sent.push(args);
  }
}
```

- [ ] **Step 3: Write the real adapter** (Resend, pending Task 2's final pick — adjust class/endpoint name if ADR-0013 picks Postmark instead)

```typescript
import { Injectable } from '@nestjs/common';
import { NotificationProvider, SendEmailArgs } from './notification-provider';

@Injectable()
export class ResendNotificationProvider implements NotificationProvider {
  constructor(private readonly apiKey: string, private readonly fromAddress: string) {}

  async sendEmail(args: SendEmailArgs): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.fromAddress, to: args.to, subject: args.subject, html: args.body }),
    });
    if (!res.ok) {
      // Fire-and-forget with logged failure, no retry queue (design doc decision) — Phase 3+ escalation path if needed.
      console.error(`ResendNotificationProvider: send failed (${res.status})`, await res.text());
    }
  }
}
```

- [ ] **Step 4: Write `notifications.providers.ts`** (mirrors `documents.providers.ts`'s conditional-factory pattern exactly)

```typescript
import { Provider } from '@nestjs/common';
import { FakeNotificationProvider } from './fake-notification-provider';
import { ResendNotificationProvider } from './resend-notification-provider';
import { NotificationProvider } from './notification-provider';

export const NOTIFICATION_PROVIDER = 'NOTIFICATION_PROVIDER' as const;

export const notificationProviderProvider: Provider = {
  provide: NOTIFICATION_PROVIDER,
  useFactory: (): NotificationProvider => {
    const apiKey = process.env.RESEND_API_KEY;
    const fromAddress = process.env.NOTIFICATION_FROM_ADDRESS ?? 'noreply@example.com';
    return apiKey ? new ResendNotificationProvider(apiKey, fromAddress) : new FakeNotificationProvider();
  },
};

export type { NotificationProvider };
```

- [ ] **Step 5: Write the failing test for `NotificationDispatchService.notifyEventCreated`**

```typescript
it('emails every other group member, excluding the creator', async () => {
  const fake = new FakeNotificationProvider();
  // ... build service with GroupsRepository returning a group with 3 memberUserIds, one matching event.createdBy ...
  await service.notifyEventCreated(event);
  expect(fake.sent).toHaveLength(2); // not 3 — creator excluded
});
```

- [ ] **Step 6: Run, confirm fail; implement `NotificationDispatchService` (event/task triggers only for this task)**

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { GroupsRepository, UsersRepository } from '@kms/data';
import { EventDocument, TaskDocument } from '@kms/data';
import { NOTIFICATION_PROVIDER, NotificationProvider } from './notifications.providers';

@Injectable()
export class NotificationDispatchService {
  constructor(
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProvider,
    private readonly groups: GroupsRepository,
    private readonly users: UsersRepository,
  ) {}

  /** Trigger 1 (design doc decision 6): always-on, not preference-gated. */
  async notifyEventCreated(event: EventDocument): Promise<void> {
    const group = await this.groups.findById(event.groupId);
    if (!group) return;
    const recipients = group.memberUserIds.filter((id) => !id.equals(event.createdBy));
    await this.emailUsers(recipients, `Invited: ${event.title}`, `You've been invited to "${event.title}" on ${event.startAt.toISOString()}. View in app.`);
  }

  /** Trigger 2 (design doc decision 6): always-on, fires on initial assignment and reassignment. */
  async notifyTaskAssigned(task: TaskDocument): Promise<void> {
    if (!task.assigneeUserId) return;
    await this.emailUsers([task.assigneeUserId], `Assigned: ${task.title}`, `You've been assigned to "${task.title}"${task.dueDate ? `, due ${task.dueDate.toISOString()}` : ''}. View in app.`);
  }

  private async emailUsers(userIds: import('mongoose').Types.ObjectId[], subject: string, body: string): Promise<void> {
    const recipients = await Promise.all(userIds.map((id) => this.users.findById(id)));
    await Promise.all(
      recipients.filter((u): u is NonNullable<typeof u> => !!u).map((u) => this.provider.sendEmail({ to: u.email, subject, body })),
    );
  }
}
```

- [ ] **Step 7: Run, confirm pass; register in `AppModule`; full workspace check; commit**

```bash
git add apps/api/src/notifications/ apps/api/src/app.module.ts
git commit -m "feat: NotificationProvider adapter + always-on event/task email triggers"
```

---

### Task 7: `userNotificationPreferences` collection + preferences controller

**Files:**
- Create: `libs/data/src/models/user-notification-preference.schema.ts`
- Create: `libs/data/src/repositories/user-notification-preferences.repository.ts`
- Modify: `libs/data/src/index.ts`
- Create: `apps/api/src/notifications/notification-preferences.controller.ts`
- Create: `apps/api/src/notifications/notification-preferences.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces: `UserNotificationPreferencesRepository.findOrCreateForUser(userId)`, `.updateForUser(userId, patch)` — consumed by Task 8's dispatch logic.

- [ ] **Step 1: Write the failing schema test, then `user-notification-preference.schema.ts`**

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

export type PreferenceScope = 'off' | 'mine' | 'all';

/** One document per user, all fields default 'off' — opt-in (Phase 2A design, decision 9). */
@Schema({ collection: 'userNotificationPreferences', timestamps: true })
export class UserNotificationPreference {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, unique: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, enum: ['off', 'mine', 'all'], default: 'off' })
  fileAdded!: PreferenceScope;

  @Prop({ required: true, enum: ['off', 'mine', 'all'], default: 'off' })
  fileDeleted!: PreferenceScope;

  @Prop({ required: true, enum: ['off', 'mine', 'all'], default: 'off' })
  taskAdded!: PreferenceScope;

  @Prop({ required: true, enum: ['off', 'mine', 'all'], default: 'off' })
  taskDeleted!: PreferenceScope;

  @Prop({ required: true, enum: ['off', 'mine', 'all'], default: 'off' })
  taskStatusChanged!: PreferenceScope;
}

export type UserNotificationPreferenceDocument = HydratedDocument<UserNotificationPreference> & { _id: Types.ObjectId };
export const UserNotificationPreferenceSchema = SchemaFactory.createForClass(UserNotificationPreference);
UserNotificationPreferenceSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
UserNotificationPreferenceSchema.plugin(tenantScopeBackstopPlugin);
```

- [ ] **Step 2: Write `UserNotificationPreferencesRepository`**

```typescript
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model, Types } from 'mongoose';
import { ScopedRepository } from '../scoped-repository';
import { UserNotificationPreference, UserNotificationPreferenceDocument } from '../models/user-notification-preference.schema';

@Injectable()
export class UserNotificationPreferencesRepository extends ScopedRepository<UserNotificationPreference> {
  constructor(@InjectModel(UserNotificationPreference.name) model: Model<UserNotificationPreference>, cls: ClsService) {
    super(model, cls);
  }

  async findOrCreateForUser(userId: Types.ObjectId): Promise<UserNotificationPreferenceDocument> {
    const existing = await (this.find({ userId }) as unknown as Promise<UserNotificationPreferenceDocument[]>);
    if (existing[0]) return existing[0];
    return this.create({
      userId,
      fileAdded: 'off',
      fileDeleted: 'off',
      taskAdded: 'off',
      taskDeleted: 'off',
      taskStatusChanged: 'off',
    }) as unknown as Promise<UserNotificationPreferenceDocument>;
  }

  findAllWithPreference(field: 'fileAdded' | 'fileDeleted' | 'taskAdded' | 'taskDeleted' | 'taskStatusChanged', value: 'mine' | 'all'): Promise<UserNotificationPreferenceDocument[]> {
    return this.find({ [field]: value }) as unknown as Promise<UserNotificationPreferenceDocument[]>;
  }
}
```

Export both from `libs/data/src/index.ts`.

- [ ] **Step 3: Write the controller** (design doc: **no `@Module` gate** — core document notifications aren't an opt-in module)

```typescript
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { SCOPE_CLS_KEY, Scope, UserNotificationPreferencesRepository } from '@kms/data';

@Controller('users/me/notification-preferences')
export class NotificationPreferencesController {
  constructor(
    private readonly cls: ClsService,
    private readonly preferences: UserNotificationPreferencesRepository,
  ) {}

  @Get()
  async get() {
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY)!;
    return this.preferences.findOrCreateForUser(scope.userId);
  }

  @Patch()
  async update(@Body() patch: Partial<{ fileAdded: string; fileDeleted: string; taskAdded: string; taskDeleted: string; taskStatusChanged: string }>) {
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY)!;
    await this.preferences.findOrCreateForUser(scope.userId); // ensures a row exists before updateOne
    await this.preferences.updateOne({ userId: scope.userId }, { $set: patch });
    return this.preferences.findOrCreateForUser(scope.userId);
  }
}
```

- [ ] **Step 4: Write and run controller tests (GET creates-on-first-read, PATCH updates one field, other fields unchanged), confirm pass**

- [ ] **Step 5: Register in `AppModule`; full workspace check; commit**

```bash
git add libs/data/src/models/user-notification-preference.schema.ts \
  libs/data/src/repositories/user-notification-preferences.repository.ts libs/data/src/index.ts \
  apps/api/src/notifications/notification-preferences.controller.ts \
  apps/api/src/notifications/notification-preferences.controller.spec.ts apps/api/src/app.module.ts
git commit -m "feat: user notification preferences (off/mine/all)"
```

---

### Task 8: Preference-gated triggers — retrofit into upload/delete/task controllers

**This is the task flagged in the design doc's "cross-phase dependency" note — it touches already-shipped, tested Phase 2.3/2.5 code. Re-run those existing suites, don't just add new tests.**

**Files:**
- Modify: `apps/api/src/documents/documents.controller.ts` (`upload()` and `delete()` methods)
- Modify: `apps/api/src/groups/tasks.controller.ts` (`create`, `remove`, `update` — extend Task 5's stubs)
- Create: `apps/api/src/notifications/notification-dispatch.service.spec.ts` extensions for the preference-resolution logic
- Modify: `apps/api/src/notifications/notification-dispatch.service.ts` (add preference-gated methods)
- Create: `apps/api/src/notifications/folder-group-access.ts` (small helper — see Step 1)

**Interfaces:**
- Consumes: `UserNotificationPreferencesRepository.findAllWithPreference`, `FoldersRepository` + `GroupsRepository` (for "all files in a folder this group can read" — reuses ADR-0005's grant lookup, same as `DocumentsPermissionsService`).
- Produces: `NotificationDispatchService.notifyFileAdded(document)`, `.notifyFileDeleted(document)`, `.notifyTaskAdded/Deleted/StatusChanged(task)`.

- [ ] **Step 1: Write the "all" resolver for files** — "any document in a folder the relevant group has read access to" (design doc decision, spec-review addition). Reuse `resolveFolderPermissionsCached`/`toFolderInputs`/`toPrincipalSet` from `@kms/permissions`, the exact same functions `DocumentsPermissionsService` already uses — but resolve for a **group's** principal set (the group itself, not a specific user) rather than a user's. Check `libs/permissions`'s `toPrincipalSet` signature before writing this — if it only accepts a user+their groups (not a bare group id), the simplest correct approach is: a folder is "accessible to group G" iff any of G's grants include it directly (query `folders` where `grants.principalId == groupId`), which avoids needing per-user resolution here at all.

```typescript
import { FoldersRepository } from '@kms/data';
import { Types } from 'mongoose';

/** "All files in the group" = any folder whose grants directly name this group (Phase 2A spec-review decision — reuses ADR-0005's grant model, no new folder-→group ownership concept). */
export async function foldersAccessibleToGroup(folders: FoldersRepository, groupId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const all = await folders.findAllForTenant();
  return all.filter((f) => f.grants.some((g) => g.principalType === 'group' && g.principalId.equals(groupId))).map((f) => f._id);
}
```

(Verify `folders.grants[].principalId`'s exact field name against `libs/data/src/models/folder.schema.ts` before writing this — it wasn't read during this plan's grounding pass; confirm before implementing.)

- [ ] **Step 2: Extend `NotificationDispatchService` with preference-gated methods**

```typescript
async notifyFileAdded(document: DocumentDocument, actorUserId: Types.ObjectId): Promise<void> {
  await this.dispatchPreferenceGated('fileAdded', document.folderId, actorUserId, document.createdBy,
    `New file: ${document.name}`, `A new file "${document.name}" was added.`);
}

async notifyFileDeleted(document: DocumentDocument, actorUserId: Types.ObjectId): Promise<void> {
  await this.dispatchPreferenceGated('fileDeleted', document.folderId, actorUserId, document.createdBy,
    `File deleted: ${document.name}`, `"${document.name}" was deleted.`);
}

// notifyTaskAdded/Deleted/StatusChanged follow the same shape, keyed by task.groupId instead of a folder, and
// "mine" = task.assigneeUserId ?? task.createdBy (design doc's fallback rule) instead of document.createdBy.

private async dispatchPreferenceGated(
  field: 'fileAdded' | 'fileDeleted' | 'taskAdded' | 'taskDeleted' | 'taskStatusChanged',
  folderId: Types.ObjectId,
  actorUserId: Types.ObjectId,
  mineOwnerId: Types.ObjectId,
  subject: string,
  body: string,
): Promise<void> {
  const [minePrefs, allPrefs] = await Promise.all([
    this.preferences.findAllWithPreference(field, 'mine'),
    this.preferences.findAllWithPreference(field, 'all'),
  ]);

  const mineRecipients = minePrefs
    .filter((p) => p.userId.equals(mineOwnerId) && !p.userId.equals(actorUserId))
    .map((p) => p.userId);

  // "all" is evaluated per-user against every group they belong to (design doc: global-per-user, decision 9).
  const allCandidates = allPrefs.filter((p) => !p.userId.equals(actorUserId));
  const allRecipients: Types.ObjectId[] = [];
  for (const pref of allCandidates) {
    const userGroups = await this.groups.findForMember(pref.userId);
    const relevant = await Promise.all(userGroups.map((g) => foldersAccessibleToGroup(this.folders, g._id)));
    if (relevant.flat().some((id) => id.equals(folderId))) allRecipients.push(pref.userId);
  }

  const recipients = [...new Set([...mineRecipients, ...allRecipients].map((id) => id.toString()))].map((s) => new Types.ObjectId(s));
  await this.emailUsers(recipients, subject, body);
}
```

(This is written against `folderId` for the file case; the task case needs a parallel path keyed on `groupId` directly rather than resolving folders — write `dispatchPreferenceGatedForGroup` as a sibling, or generalize the "all" loop to accept either a direct `groupId` match or a folder-accessibility check. Resolve this cleanly rather than duplicating the whole method — a reviewer should be able to tell the file and task paths share the actor-exclusion and dedup logic.)

- [ ] **Step 3: Write failing tests for the preference matrix** — `off`/`mine`/`all` × file/task × actor-excluded, at minimum:
  - User with `fileAdded: 'off'` never gets an email.
  - User with `fileAdded: 'mine'` gets an email only when they're the uploader.
  - User with `fileAdded: 'all'` gets an email for any upload into a folder one of their groups can read, but not otherwise.
  - The uploader never gets an email about their own upload, even with `fileAdded: 'all'`.

- [ ] **Step 4: Run, confirm fail; wire into `DocumentsController`**

In `upload()` (`apps/api/src/documents/documents.controller.ts`, after `this.documents.createDocument(...)`, before the `return` at line ~277-280):

```typescript
await this.auditEvents.record({ action: 'document.upload', targetId: documentId, metadata: { versionId: version._id.toString() } }); // discovered gap — upload had no audit event at all
await this.notifications.notifyFileAdded(await this.documents.findById(documentId), scope.userId);
```

In `delete()` (after the existing `this.auditEvents.record({action: 'document.delete', ...})` call, before `return`):

```typescript
await this.notifications.notifyFileDeleted(existing, scope.userId);
```

Add `NotificationDispatchService` to `DocumentsController`'s constructor DI.

- [ ] **Step 5: Wire into `TasksController`** (Task 5) — extend the `create`/`update`/`remove` handlers with the equivalent `notifyTaskAdded`/`notifyTaskStatusChanged`/`notifyTaskDeleted` calls, actor excluded.

- [ ] **Step 6: Run the new tests, confirm pass**

- [ ] **Step 7: Re-run Phase 2.3/2.5's existing test suites — this is the critical regression check**

Run: `pnpm --filter api test:unit -- documents.controller.spec`
Run: `pnpm --filter api test:integration` (whichever suite covers upload/delete integration per the Phase 2 plan)
Expected: 100% pass, same count as before this task — if anything that was green before is now red or newly skipped, stop and fix before continuing.

- [ ] **Step 8: Full workspace check; commit**

```bash
git add apps/api/src/documents/documents.controller.ts apps/api/src/groups/tasks.controller.ts \
  apps/api/src/notifications/
git commit -m "feat: preference-gated file/task notifications; fix missing upload audit event"
```

---

### Task 9: Integration/cross-tenant coverage for the new routes

**The shared `test/cross-tenant` harness (`test/cross-tenant/cross-tenant.spec.ts`) is still a skeleton — its `it.todo`s aren't implemented yet (that's Phase 2.7's job, not this plan's). Don't pretend to "extend" a working harness that doesn't exist. Instead, add real integration tests directly in `apps/api`, following the same pattern already used for Phase 2.3/2.5's own cross-tenant assertions.**

**Files:**
- Create: `apps/api/test/events-cross-tenant.integration.spec.ts` (or the existing integration-test directory's naming convention — check `apps/api/test/*.integration.spec.ts` for the exact pattern before naming this)
- Create: `apps/api/test/tasks-cross-tenant.integration.spec.ts`
- Create: `apps/api/test/notification-preferences.integration.spec.ts`

**Interfaces:**
- Consumes: whatever test-tenant/test-session fixture helpers Phase 2.3/2.5's own integration tests already built (check `apps/api/test/` for existing helpers before writing new ones — do not duplicate a fixture-creation helper that already exists).

- [ ] **Step 1: Locate the existing integration-test fixture helpers** (tenant-A/tenant-B session creation, used by Phase 2.3/2.5's own cross-tenant integration assertions) and reuse them — don't reinvent.

- [ ] **Step 2: Write and run — events cross-tenant/non-member/module-disabled matrix**

```typescript
it('404s a cross-tenant groupId', async () => { /* tenant A session, tenant B's groupId → 404 */ });
it('404s a non-member of the group', async () => { /* tenant A user not in the group → 404 */ });
it('404s when the tenant has calendar disabled', async () => { /* tenant.featureToggles = [] → 404 on all /events routes */ });
```

- [ ] **Step 3: Same matrix for tasks**

- [ ] **Step 4: Notification-preferences: confirm the route works with `calendar`/`kanban` both disabled** (design doc: no `@Module` gate on this controller)

- [ ] **Step 5: Full workspace check (`pnpm turbo run build lint test:unit test:integration`); commit**

```bash
git add apps/api/test/events-cross-tenant.integration.spec.ts apps/api/test/tasks-cross-tenant.integration.spec.ts \
  apps/api/test/notification-preferences.integration.spec.ts
git commit -m "test: cross-tenant/module-disabled coverage for Phase 2A routes"
```

---

### Task 10: UI spec addendum (doc only — no UI code in this plan)

**Matches how Phase 2's own 2.6 (Web UI) was sequenced as a separate, later item after 2.1-2.5's backend landed — this plan stops at a complete, tested backend plus the spec an eventual UI task needs.**

**Files:**
- Create: `docs/ui/calendar-kanban-notifications-addendum-v01.md`

- [ ] **Step 1: Write the addendum**, following `docs/ui/screens_spec_v01.md`'s existing format (screen inventory, roles, states, RTL/security constraints per its stated conventions). Cover: calendar view (month/week), kanban board view (3 fixed columns, drag-and-drop — library choice is an implementation detail for whoever builds this screen, not fixed here), notification-preferences settings screen (5 tri-state toggles, `taskAdded`/`taskDeleted`/`taskStatusChanged` hidden when the tenant's `kanban` module is off).

- [ ] **Step 2: Commit**

```bash
git add docs/ui/calendar-kanban-notifications-addendum-v01.md
git commit -m "docs: UI spec addendum for calendar/kanban/notification-preferences screens"
```

---

## Self-Review Notes

- **Spec coverage:** all 9 decisions in the design doc map to a task above (cardinality → Task 4/5 schemas; edit permissions → Task 4 `GroupsMembershipService`; invitations → Task 6; kanban columns → Task 5; due-dates-on-calendar → Task 5's `CalendarController`; notification triggers → Task 6+8; email provider → Task 2; audit trail → Tasks 4/5/8; notification preferences → Task 7+8).
- **Placeholder scan:** Task 9's fixture-helper step (Step 1) intentionally defers to whatever already exists rather than inventing one sight-unseen — this is a "verify before writing," not a placeholder; the assertions that follow it are concrete. Task 8 Step 1 similarly flags an unverified field name (`folders.grants[].principalId`) rather than guessing it — check it first, don't guess.
- **Type consistency:** `EventDocument`/`TaskDocument`/`UserNotificationPreferenceDocument` names are used consistently between their defining task and every later task that consumes them (5, 6, 8). `NotificationDispatchService`'s method names (`notifyEventCreated`, `notifyTaskAssigned`, `notifyFileAdded`, `notifyFileDeleted`, `notifyTaskAdded/Deleted/StatusChanged`) are introduced once (Tasks 6/8) and referenced by the same names in Tasks 4/5/8's controller code — no renaming drift.
