# Design: Calendar & Task Management (Phase 2A)

**Date:** 2026-08-04
**Status:** Approved (brainstorming session), not yet ADR'd or planned
**Roadmap:** `docs/plans/implementation-phases-11-07-2026-plan.md` — Phase 2A
**Related:** ADR-0001 (tenant scoping), ADR-0005 (folder/group permissions — group membership reused here), ADR-0009 (edition gating — module-entitlement mechanism extends this pattern)

## Context

A customer wants calendar + task management as their MVP. This feature is generic — it attaches to any `group` and has no dependency on the Kibbutz-governance/committee model that prompted the original brainstorming session (see "Future (deferred) — Governance/Committee Module" in the roadmap plan). It ships independently and does not require Phase 3 (ingestion) or Phase 4 (chat/RAG).

Calendar, kanban, the deferred governance module, and LLM/chat itself are each **separately-priced, opt-in modules per tenant** — this is a new axis of product configuration beyond the existing binary KB/OCR edition split (ADR-0009), so a module-entitlement mechanism is a hard prerequisite for this feature and is scoped as part of it (not deferred).

**Cross-phase dependency (added on spec review):** the notification-preferences requirement (decision 9 below) covers file uploads/deletions, not just calendar/kanban events. Firing those triggers means adding hook calls into the **already-shipped** Phase 2.3 (upload) and Phase 2.5 (recycle bin/delete) controllers — this is a retrofit onto completed, tested code, not new code built in isolation. The implementation plan must include re-running Phase 2's existing test suite alongside the new notification tests, not just adding new tests.

## Decisions

Settled during brainstorming (2026-08-04), in order of discussion:

1. **Cardinality:** exactly one calendar and one kanban board per group — no multi-board/multi-calendar picker for MVP.
2. **Edit permissions:** any group member (per `groups.members`, ADR-0005) can create, edit, move, and delete events and tasks in that group — no separate read/edit/manage tiers like folders have. This includes delete: any member can delete any card/event (shared-collaborative model, like a group to-do list), not just the creator.
3. **Invitations:** simple notify email only — "you've been invited to X on date Y, view in app" with a link back into the app. No ICS attachment, no RSVP/accept-decline tracking, no recurring-event rules. Recurring meetings are created as individual one-off events for now.
4. **Kanban columns:** fixed three columns — `todo`, `in_progress`, `done`. Not admin-configurable in MVP.
5. **Task due dates surface on the calendar:** a task with a `dueDate` appears in the group's calendar view alongside actual events (merged read, not a stored duplicate).
6. **Notification triggers:** email on event creation (to all group members except the creator) and on task assignment (to the assignee). No due-date reminder digests (would need a scheduler + digest logic — meaningfully more infrastructure than requested; recorded as a future enhancement, not built now).
7. **Email provider:** pull Phase 5.4's "transactional email provider decision" forward and settle it here rather than duplicating the decision later — same provider will also serve password-reset/security emails (currently unimplemented per Phase 1 notes). Candidates: Resend or Postmark, both offering EU data residency + a DPA (design-review finding 11's constraint) and a simple HTTP API that pins as a named egress endpoint (ADR-0007 pattern). Final pick happens in the ADR below, not in this design doc.
8. **Audit trail (added on spec review):** calendar/kanban events extend the *existing* tenant audit log (ADR-0002's `auditEvents` collection, PRD §12) with new coverage entries — not a new mechanism. Still admin-only per PRD §12's existing access rule; no new group-visible activity feed for MVP.
9. **Per-user notification preferences (added on spec review):** users can opt in, per event category, to emails for file/task lifecycle changes, each scoped to "mine" or "all in the group." Preferences are global per user (apply across every group they belong to) for MVP — per-group overrides deferred. The actor who performs an action is never notified of their own action (consistent with the existing "email to all group members except the creator" rule for event invites).

## Architecture

### Module entitlement (new — extends ADR-0009)

```
tenants.enabledModules: ('governance' | 'kanban' | 'calendar' | 'llm')[]
```

A `@Module('calendar' | 'kanban')` decorator + `ModuleGuard`, structurally identical to the existing `@Edition`/`EditionGuard` pair: reads `tenant.enabledModules` from the CLS scope, returns **404** (not 403, consistent with sec §3.2) for routes whose required module isn't enabled on the tenant. Registered as a global `APP_GUARD` alongside `EditionGuard`. A new bootstrap assertion (mirroring `assertEditionCoverage`) fails startup if a controller lacks a `@Module(...)` decorator, once module-gated controllers exist.

This guard is deliberately generic across all four module flags (governance included) even though only `calendar`/`kanban` ship in this phase — the deferred governance module reuses it unchanged when it's eventually built.

### Data model

No `calendars`/`boards` collections — the 1:1 cardinality with `group` means `groupId` is enough:

```
events: {
  _id, tenantId, groupId,
  title, description?, startAt: Date, endAt: Date, location?,
  createdBy: userId, createdAt
}

tasks: {
  _id, tenantId, groupId,
  title, description?,
  column: 'todo' | 'in_progress' | 'done',
  assigneeUserId?: userId, dueDate?: Date,
  createdBy: userId, createdAt, updatedAt
}
```

Both collections use `ScopedRepository` (ADR-0001) for tenant isolation — no new isolation mechanism needed.

```
userNotificationPreferences: {
  _id, tenantId, userId,
  fileAdded: 'off' | 'mine' | 'all',
  fileDeleted: 'off' | 'mine' | 'all',
  taskAdded: 'off' | 'mine' | 'all',
  taskDeleted: 'off' | 'mine' | 'all',
  taskStatusChanged: 'off' | 'mine' | 'all',
}
```

One document per user, default all fields `'off'` (opt-in, per decision 9). `ScopedRepository`-backed. "Mine" scope: for files, the uploader (`documents.createdBy`, ADR-0006); for tasks, the assignee (`tasks.assigneeUserId`), falling back to the creator if unassigned. "All" scope: for files, any document in a folder the relevant group has read access to (reuses ADR-0005's existing grant lookup — no new folder→group ownership field); for tasks, any task with that `groupId`. A user's preference is evaluated against every group they belong to (global-per-user, not per-group — decision 9).

### Audit trail (extends PRD §12, ADR-0002's `auditEvents`)

No new collection or mechanism — `auditEvents` (ADR-0002: append-only, `create`-only repository, `{tenantId, ts}` indexed, daily WORM export) already exists as a cross-cutting requirement every feature hooks into (ADR-0005 does this for grant changes, ADR-0006 for deletions). Phase 2A adds these entries to PRD §12's coverage list:

- `calendar.event.created`, `calendar.event.deleted`
- `kanban.task.created`, `kanban.task.deleted`, `kanban.task.statusChanged`

Each entry carries the existing `auditEvents` shape (actor, tenantId, ts, action, target) plus `groupId` and the relevant entity id. Still tenant-admin-only per PRD §12's existing access rule — no new UI, no new access-control model (decision 8).

### Authorization

Simpler than ADR-0005's folder tiers: membership is binary. A user may read/create/edit/move/delete any event or task in `groupId` iff `userId ∈ groups[groupId].members` (directly, or via a group the user belongs to — reuses the existing `groups` collection's membership, not a new principal-resolution step). No caching layer needed here (unlike ADR-0005's Redis-cached permission resolution) — group membership lookups are cheap and don't have the same hot-path/fan-out profile as folder-tree resolution.

Non-members get **404** on any route for that group's events/tasks (never 403, never a list that reveals the group exists).

### Notifications / email

- **Trigger 1 — event created:** email to every other group member (always on, not preference-gated — this is the existing "invitation" behavior). Simple template: title, date/time, location if set, "view in app" link.
- **Trigger 2 — task assigned:** email to the new assignee (fires on initial assignment and on reassignment; always on, not preference-gated). Template: title, due date if set, "view in app" link.
- **Trigger 3–7 — preference-gated (decision 9):** `fileAdded`, `fileDeleted`, `taskAdded`, `taskDeleted`, `taskStatusChanged`. Each fires only for users whose `userNotificationPreferences` field for that category is `'mine'` (and they match the "mine" rule above) or `'all'` (any group they belong to that the event touches) — default `'off'` means no email. The actor who performed the action is excluded from its own notification, consistent with trigger 1/2's existing rule.
- No ICS, no RSVP state, no recurrence, no due-date digest jobs.
- Provider integration lives behind a `NotificationProvider` interface (mirrors the existing `ChatProvider`/`EmbeddingProvider` adapter pattern from `libs/ai-providers`, ADR-0008) so the Resend/Postmark choice is swappable without touching call sites — same swap-safety rationale as the AI provider adapters.
- All sends are fire-and-forget with logged failures for MVP — no retry queue. If this proves unreliable in practice, a BullMQ-backed retry (reusing the existing `redis-queue` infrastructure from ADR-0003) is the documented escalation path, not built now.

### API surface (sketch — finalized in the implementation plan)

```
GET    /groups/:groupId/events
POST   /groups/:groupId/events
PATCH  /groups/:groupId/events/:eventId
DELETE /groups/:groupId/events/:eventId

GET    /groups/:groupId/tasks
POST   /groups/:groupId/tasks
PATCH  /groups/:groupId/tasks/:taskId        // includes column moves and reassignment
DELETE /groups/:groupId/tasks/:taskId

GET    /groups/:groupId/calendar?from=&to=   // merged read: events + tasks with dueDate in range

GET    /users/me/notification-preferences
PATCH  /users/me/notification-preferences    // updates the tri-state fields on userNotificationPreferences
```

The `events`/`tasks`/`calendar` routes carry `@Module('calendar')` or `@Module('kanban')` as appropriate. The merged calendar-read route requires only `@Module('calendar')`; it includes due-dated tasks in the response when `kanban` is also enabled on the tenant, and silently omits them (events-only) when it isn't — a disabled adjacent module degrades the response, it doesn't 404 the route, since this is a read endpoint, not a boundary the module-entitlement guard needs to protect.

The `notification-preferences` routes carry **no `@Module` gate** — `fileAdded`/`fileDeleted` are about the core document system (Phase 2, always part of the base KB edition, not an opt-in module), so a tenant without calendar/kanban enabled must still be able to set file-notification preferences. The UI simply hides the `taskAdded`/`taskDeleted`/`taskStatusChanged` toggles when the tenant's `kanban` module is disabled; the underlying fields stay harmless-but-inert.

### UI

Calendar view (month/week), kanban board view (three fixed columns, drag-and-drop), and a notification-preferences settings screen (per-category tri-state toggles) need a UI spec addendum to `docs/ui/screens_spec_v01.md` before implementation — not designed in this document. Drag-and-drop library choice (e.g. `@dnd-kit`) is an implementation-plan detail, not a design decision. Tenant admins still read the audit log through whatever admin audit-log screen the base product eventually ships (not new to this phase) — the new event types just appear in its existing coverage list.

## Testing

- **Unit:** group-membership authorization (member/non-member matrix), `ModuleGuard` 404 behavior (module disabled → 404 before any DB query), notification triggers fire on the right events (provider call mocked, no real sends), notification-preference resolution (`off`/`mine`/`all` × file/task × actor-excluded matrix), `auditEvents` entries written with correct action/target for every new event type.
- **Integration:** merged calendar-read correctness (events + due-dated tasks, date-range filtering); Phase 2 regression — the existing upload/recycle-bin/delete integration suite (2.3/2.5) must stay green after adding notification hook calls into those controllers.
- **Cross-tenant suite (test/cross-tenant):** replay calendar/kanban routes under (a) a tenant with the module disabled → 404, (b) a user who isn't a group member → 404, (c) cross-tenant groupId → 404. Extends the existing route-enumeration harness (ADR-0009 CI mapping), doesn't need a new harness.

## Explicitly deferred (not built in this phase)

- Recurring events / RSVP tracking / ICS attachments.
- Due-date reminder digest emails (needs a scheduler).
- Admin-configurable kanban columns.
- Multiple calendars/boards per group.
- Per-group notification-preference overrides (MVP is one global preference set per user across all their groups).
- A member-visible group activity feed (audit trail stays admin-only per PRD §12 for MVP).
- Retry queue for failed notification sends (BullMQ escalation path documented above, not built).
- The governance/committee module itself (separate deferred section in the roadmap plan) — this design's `ModuleGuard` is built to accommodate it later, but no governance-specific code ships here.

## Open items for the implementation plan (not resolved here)

- Final email provider pick (Resend vs. Postmark) — needs a short ADR extending ADR-0009, since it's an external-dependency decision with security/compliance implications (design-review finding 11), not just an implementation detail.
- Delete-permission scope was explicitly confirmed as "any member" during brainstorming — flagged here in case that's revisited before build.
