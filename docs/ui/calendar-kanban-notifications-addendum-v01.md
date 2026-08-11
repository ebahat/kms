# UI Screens Requirements — Calendar/Kanban/Notification-Preferences Addendum v01

Date: 2026-08-12 · Status: DRAFT for review
Sources: `docs/ui/screens_spec_v01.md` (base spec — this addendum follows its conventions and doesn't
repeat its global requirements §3.1–3.5, which apply unchanged here), `docs/superpowers/specs/2026-08-04-calendar-kanban-design.md`
(design doc, 9 decisions), `docs/plans/phase-2a-calendar-kanban-04-08-2026-plan.md` (implementation —
backend complete through Task 9 at the time of writing)
Fidelity: same as the base spec — **shaped spec**, not visual design. Layout/component choices are
deliberately not specified here.

Per Task 10 of the Phase 2A plan: **doc only, no UI code.** This gives whoever builds Phase 2A's UI
(a later, separate task — same sequencing as the base spec's own §7.2, where Phase 2's 2.6 followed
2.1–2.5's backend) the spec it needs, matching a tested, already-shipped backend rather than a
speculative one.

## 1. Scope

Three new screens/surfaces, all gated behind the module-entitlement mechanism (`ModuleGuard`,
`tenant.enabledModules`) introduced alongside this feature — a new gating axis parallel to the base
spec's KB/OCR edition split, not a replacement for it. Attaches to the existing `groups` collection
(ADR-0005) — no new tree/hierarchy concept.

## 2. Roles

Unchanged from the base spec's §2 table for the KB tenant-user row, with one addition: **any group
member** (not a tiered read/edit/manage split like folders — design decision 2) can create, edit,
move, and delete events/tasks in that group, including cards/events they didn't create. There is no
"tenant admin" elevation for these screens beyond ordinary membership — a tenant admin who isn't a
group member gets the same 404 as any other non-member (consistent with the base spec's "denied
reads render as not-found" rule, §3.2).

## 3. Global requirements

All of the base spec's §3.1–§3.5 apply unchanged (RTL/bidi, state vocabulary, mobile matrix, WCAG
2.1 AA, security constraints). Two additions specific to this addendum:

- **Module-disabled is a 404, not a screen state.** A tenant without `calendar`/`kanban` enabled
  never sees these screens in navigation at all (same "absence, not a denied screen" pattern as
  out-of-permission folders, base spec §3.2) — this isn't a new state to design, it's the existing
  denied-state convention applied to a new gating axis.
- **No "pending changes" state anywhere in this addendum.** Every mutation (event/task create-edit-
  move-delete, notification-preference toggle) takes effect immediately on the same request that
  produces it — consistent with C3's existing "no pending state" folder-permission precedent in the
  base spec.

## 4. Screen inventory

### F. Calendar & Task Management (both editions where enabled; opt-in modules)

| # | Screen | Pri | Purpose / key requirements |
|---|---|---|---|
| F1 | Calendar view (month/week) | P0 | One calendar per group (design decision 1 — no picker). Reads `GET /groups/:groupId/calendar?from=&to=`, which returns `{events, tasks}` merged — tasks with a `dueDate` appear alongside real events (design decision 5), visually distinguished from events (e.g. a due-date marker vs. a timed block), never conflated into one item type. **Degradation, not denial:** if the tenant has `kanban` disabled, the response's `tasks` array is always empty — the screen simply never shows due-date markers; this is silent degradation on a read endpoint, not a 404, and needs no explicit empty/error state beyond the ordinary empty-range case. Create/edit/delete an event inline or via a form (any member, per role note above); no recurrence UI (design decision 3 — recurring meetings are individual one-off events). Invitee list is implicit (all current group members) — there is no per-invitee picker, RSVP status, or ICS export/import surface anywhere in this screen (explicitly deferred). Week/month toggle; RTL: date grid mirrors, but date-cell contents (day numbers) stay LTR per the base spec's number-formatting rule (§3.1). |
| F2 | Kanban board | P0 | One board per group (design decision 1), exactly three fixed columns — `todo` / `in_progress` / `done` — not admin-configurable (design decision 4), so no "add column" affordance exists anywhere in this screen. Drag-and-drop card between columns (library choice is an implementation detail, not fixed here); a column move is a `PATCH /groups/:groupId/tasks/:taskId` with the new column — same endpoint reassignment uses, so a single PATCH can carry both a move and a reassignment together (mirrors the backend's actual single-PATCH design). Card shows title, assignee (if any), due date (if any); any member can move or delete any card, not just its creator or assignee (design decision 2) — the UI does not hide delete/move affordances based on card ownership. Empty column state: first-use guidance per column (base spec §3.2's empty-state rule), not a bare blank list. RTL: column order mirrors (rightmost = `todo` in RTL, matching the base spec's navigation-mirrors rule); card internals (assignee avatar, due-date text) follow the same bidi-isolation rule as filenames elsewhere in the product (base spec §3.1). |
| F3 | Task/event creation & edit form | P0 | Shared-ish shape between the two entity types but not literally the same form: events require `startAt`/`endAt` (+ optional `location`), tasks have an optional `dueDate` + `assigneeUserId` (any group member, single assignee — no multi-assign) + starting column (always `todo` on create, per the backend's `TasksController.create`). Assignee picker is scoped to the group's own member list only — never a tenant-wide user picker, since assigning outside the group has no meaning here. No due-date reminder scheduling UI (design decision 6 — no digest jobs built). |
| F4 | Notification preferences | P0 | `GET`/`PATCH /users/me/notification-preferences` — five tri-state toggles (`off` / `mine` / `all`), one row per category: `fileAdded`, `fileDeleted`, `taskAdded`, `taskDeleted`, `taskStatusChanged`. **Not gated by any module** — the route has no `@Module` decorator at all (design decision 9's cross-phase note: `fileAdded`/`fileDeleted` cover the base KB document system, which every tenant has regardless of calendar/kanban entitlement) — this screen must render and function for a tenant with every optional module disabled. The UI-level rule that *is* module-driven: hide the `taskAdded`/`taskDeleted`/`taskStatusChanged` rows entirely (not disable them — remove them) when the tenant's `kanban` module is off, since those toggles would control a feature the tenant can't otherwise reach; `fileAdded`/`fileDeleted` are always shown. Preferences are global per user across every group they belong to for MVP — the screen has no per-group override UI (design decision 9; explicitly deferred). Copy for each scope should be concrete, not just the raw enum value — e.g. "mine" reads as "only things assigned to me / that I uploaded," "all" reads as "everything in my groups" — since the literal words "off/mine/all" are not self-explanatory to a first-time user. No save/pending state: each toggle change is its own immediate `PATCH` (consistent with §3's no-pending-state rule above). |

## 5. States (non-obvious ones only, per the base spec's §3.2 convention)

- **F1/F2 module-disabled:** not a screen state — the screen doesn't exist in navigation for a tenant without the module (see §3 above). Don't design a "kanban is disabled" placeholder screen.
- **F1/F2 non-member:** same as module-disabled — a group a user isn't a member of doesn't appear in whatever group picker/nav leads to these screens; the backend 404s identically to a cross-tenant or module-disabled request (design doc's "non-members get 404... never a list that reveals the group exists"), so the UI's job is simply to never construct a link into a group the user isn't in.
- **F2 empty column:** first-use guidance per column, not a shared blank-board message — a board that's all-empty vs. a board with two full columns and one truly-never-used column ("done", for a brand-new group) should read differently at a glance.
- **F4 first load:** the preferences document is create-on-first-read server-side (`findOrCreateForUser` — all fields default `'off'`), so there is no "no preferences set yet" empty state to design; the first `GET` always returns a complete, valid, all-off row.
- **F1/F3 invitation delivery:** there is no in-app delivery-status/read-receipt state for the invitation email (design decision 3 — no RSVP tracking) — creating an event is a one-way fire that the UI shows as successful once the create request succeeds, regardless of whether the email actually lands (design doc: "all sends are fire-and-forget... no retry queue").

## 6. Cross-screen flows

1. **Event created → invited:** F3 (create) → every other current group member gets an email (always-on trigger, never preference-gated, per design decision 6) → appears in F1 immediately for all members, no separate "pending invite" state (decision 3: no RSVP).
2. **Task assigned → notified:** F3 (assign, on create or via a later edit) → the assignee gets an email (always-on trigger) → card shows the assignee in F2, and — if it has a `dueDate` — in F1 too, without duplication (merged read, design decision 5).
3. **Task/file lifecycle → preference-gated email:** any `fileAdded`/`fileDeleted`/`taskAdded`/`taskDeleted`/`taskStatusChanged` event → checked against F4's per-user, per-category `off`/`mine`/`all` setting for every user who could plausibly care (the item's owner for "mine", every group member with "all" set) → actor of the action is always excluded from its own notification (consistent with flow 1's existing "except the creator" rule). This flow has no dedicated screen of its own — it's the reason F4 exists.
4. **Audit trail (admin-only, no new screen):** every create/delete/status-change on F1–F3 writes a `calendar.event.*`/`kanban.task.*` entry into the tenant's *existing* audit log (C6 in the base spec) — this addendum adds coverage rows to C6's existing data, not a new admin screen (design decision 8).

## 7. Explicitly out of scope for these screens (matches the design doc's deferred list)

Recurring-event UI, RSVP/accept-decline UI, ICS import/export, admin-configurable kanban columns,
multiple calendars/boards per group, per-group notification-preference overrides, a member-visible
activity feed (audit stays admin-only), and any retry/delivery-status UI for notification emails.

## 8. Open questions (for review, not blockers)

1. F1's month vs. week default, and whether both are P0 or week is a fast-follow — not decided in the
   design doc or the implementation plan; flagging for whoever prototypes this screen (matches the
   base spec's own §6.2 precedent of deferring a view-mode choice to prototype).
2. F4's category copy (see F4's row above) needs actual product-copy wording, not just the
   `off`/`mine`/`all` enum values verbatim — flagging as a copy task, not a structural open question.
3. Whether F2's drag-and-drop needs a non-drag fallback (e.g. a per-card column `<select>`) for
   keyboard-only operation — the base spec's §3.4 WCAG requirement (full keyboard operability)
   applies here and drag-and-drop alone won't satisfy it; needs a concrete answer before F2 is built,
   not a implementation detail to discover late.
