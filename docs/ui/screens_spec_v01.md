# UI Screens Requirements — v01

Date: 2026-07-07 · Status: DRAFT for review
Sources: `docs/requirements_v02.md` (PRD), `docs/security_requirements_v01.md` (sec)
Fidelity: **shaped spec** — screens, roles, data, actions, and states are contractual; layout, visual design, and component choices are deliberately *not* specified here. They get decided in code prototypes (Next.js + mock data), where RTL behavior can actually be felt.

## 1. Scope and non-goals

Covers all user-facing surfaces of both editions (PRD §1): Knowledge Base (KB), Smart OCR standalone (OCR-E), and the platform-admin portal (PRD §5). Non-goals for MVP: native mobile apps (PRD §13), offline mode, real-time collaboration, external IdP login (PRD §6), device/session management UI (sec §2 — "a plus, not MVP-mandatory").

## 2. Roles (who sees what)

| Role | Surfaces |
|---|---|
| Tenant user (KB) | Auth, shell, browser, document, upload, processing queue, chat, search, favorites |
| Tenant user (OCR-E) | Auth, personal directory, upload, processing queue (PRD §15) |
| Tenant admin | All tenant-user surfaces + admin area (users, groups, permissions, recycle bin, analytics, audit, settings). In OCR-E: user/quota/metering admin only — **never file contents** (PRD §15; sec §3.5) |
| Platform admin | Separate portal, separate auth realm (PRD §5; sec §2) |

## 3. Global requirements (apply to every screen)

### 3.1 Language & RTL (PRD §2)

- UI in Hebrew (RTL, default) and English (LTR); per-user switch, tenant default set by admin. Direction follows **UI language**, not content language.
- Mixed-direction content is the norm: Hebrew UI containing English filenames, dates, protocol numbers — all user-generated strings render inside bidi isolation (`<bdi>`/`unicode-bidi: isolate`) so punctuation and numbers don't scramble.
- Numbers, dates, file sizes stay LTR within RTL layouts; timestamps localized (he-IL/en-US formats).
- Layout mirrors in RTL (navigation, chevrons, progress direction); exceptions: media/player-style controls and document page thumbnails don't mirror. Use CSS logical properties from day one — no `left/right` in new code.
- Every screen's acceptance includes: rendered and reviewed in **both** directions.

### 3.2 State vocabulary

Every screen defines its behavior for the states that apply; the spec below only lists **non-obvious** states per screen:

`loading` (skeleton, no spinners-on-white), `empty` (first-use guidance, not a blank table), `error` (user-safe message + retry; parser/provider internals never surface — sec §8.2), `denied` (out-of-tenant/out-of-permission reads render as *not found*, never as "no access" — sec §3.2), `rate-limited/budget-exhausted` (explicit, non-scary copy with what to do next — PRD §9, §10), `session-expired` (idle 30 min / absolute 12 h — PRD §3; re-auth preserves drafted input where feasible — sec §11).

### 3.3 Mobile (PRD §13; sec §11)

Responsive web; QA targets: Chrome + Samsung Internet (Android), Safari (iOS/iPadOS), plus 4 desktop browsers. The full journey — login/TOTP, upload, chat, download — must work on all of them. Known trouble spots called out per screen: iOS Safari download/blob handling, Samsung Internet dark-mode/content-blockers (sec §11). Forms are autofill/password-manager friendly (`autocomplete` attributes — sec §11).

### 3.4 Accessibility

WCAG 2.1 AA in both RTL and LTR (PRD §3): full keyboard operability, visible focus, announced async status changes (upload/processing/streaming chat), contrast-checked in light and dark.

### 3.5 Security-driven UI constraints

- No document content or tokens in browser storage; no service-worker caching of document/chat responses (sec §7.6).
- Downloads only via short-lived signed URLs with `Content-Disposition: attachment` — files never render inline from the app origin (sec §3.4, §4.4).
- Chat renderer: text formatting only — no images, no HTML, no remote loads; external links inert with visible URL; internal citation links only to the app's citation route (sec §5.2).
- Filenames are untrusted display strings — escaped everywhere (sec §4.4).

## 4. Screen inventory

Priority: P0 = MVP-blocking, P1 = MVP-should, P2 = fast-follow.

### A. Authentication & onboarding (both editions)

| # | Screen | Pri | Purpose / key requirements |
|---|---|---|---|
| A1 | Login | P0 | Email + password. Identical error copy and timing for unknown-user vs wrong-password (sec §2). States: lockout (admin-unlock message — PRD §3), CAPTCHA after repeated failures (sec §2). |
| A2 | TOTP challenge | P0 | 6-digit entry, `autocomplete="one-time-code"`; link to backup-code entry. Rate-limit state (5/5 min — sec §2). |
| A3 | TOTP enrollment | P0 | First login: QR + manual secret; then 10 backup codes shown **once**, copyable once, with download/print (sec §2, §11). Confirm-stored checkpoint before proceeding. |
| A4 | ToS/Privacy acceptance | P0 | Blocking interstitial on first login and on document re-versioning; records version + timestamp (PRD §6). |
| A5 | Password reset (request + set) | P0 | Enumeration-resistant confirmation copy (sec §2); token expiry state (≤ 30 min); new-password rules inline (min 12, breach-list — sec §2). |

### B. Knowledge Base edition — tenant user

| # | Screen | Pri | Purpose / key requirements |
|---|---|---|---|
| B1 | App shell | P0 | Tenant name + logo (PRD §4), primary nav (browser / chat / favorites / queue / admin-if-admin), language switch (PRD §2), quota banner at 80%/95% for admins (PRD §4). |
| B2 | Folder & document browser | P0 | Folder tree (≤ depth 10) + document list with metadata: status chip (queued/processing/indexed/failed — PRD §8), version number, size, upload date, creator (PRD §8). Actions gated by permission: view/download (read), upload version/move/rename/delete (edit) (PRD §7, §8). Public folders visible to all (PRD §7). Move re-applies destination permissions — confirm dialog states this (PRD §8). Denied folders simply don't appear (sec §3.2). Mobile: tree collapses to drill-down list. |
| B3 | Document detail & versions | P0 | Metadata, processing status with actionable error + retry (PRD §8), version list — view/download any retained version (read), restore (edit; restore creates new latest — PRD §8). Download = signed-URL attachment; test iOS Safari behavior explicitly (sec §3.4, §11). |
| B4 | Upload | P0 | Drag-drop + picker, multi-file; per-file validation feedback: type (PDF/DOCX/JPG/PNG), 50 MB cap, corrupt/password-protected rejection copy (PRD §8). Scanned/image files: OCR engine choice Classic vs Advanced with cost hint, hidden when admin enforces Classic-only (PRD §9); quota-insufficient rejection **before** processing: pages required vs remaining (PRD §9). Non-OCR images: "stored but not text-searchable" notice (PRD §9). |
| B5 | Processing queue (personal) | P0 | Per-document stage status, quota consumption used/remaining this month (PRD §9), failed items with sanitized reason + retry (PRD §8). Auto-refreshing; announced to screen readers (§3.4). |
| B6 | Chat | P0 | Conversation list (view/resume/delete — PRD §10, retention note per PRD §14); streaming answers (PRD §10); **citations** inline, linking to app citation route, permission re-checked at click (PRD §10); "not found in your accessible documents" as designed first-class state, not an error (PRD §10; sec §5.4); 2–3 suggested follow-ups (PRD §10); rate-limit (30 msg/h) and tenant-budget-exhausted states with "search still works" guidance (PRD §10). Mixed-language bidi in answers is the hardest rendering case in the product — prototype first. |
| B7 | Search results | P0 | Standalone hybrid search (PRD §10) — also the degraded path when chat budget is exhausted. Result = chunk snippet + document + page; opens document detail. Exact-term matches visibly distinguishable (PRD §2 priority). |
| B8 | Favorites | P1 | Folders + documents (PRD §7); items the user lost access to are hidden, not deleted (PRD §7) — no "ghost" entries. |

### C. Knowledge Base edition — tenant admin

| # | Screen | Pri | Purpose / key requirements |
|---|---|---|---|
| C1 | Users | P0 | Create/deactivate/reactivate (deactivation kills sessions immediately — PRD §6); MFA reset (audited + user notified — sec §2); CSV/Excel import with per-row validation and downloadable error report (PRD §6). |
| C2 | Groups | P0 | Create/manage groups, membership (PRD §7). |
| C3 | Folder permissions | P0 | Per-folder read/edit grants to users/groups; inheritance shown explicitly: inherited vs overridden state per subfolder, effective-permission preview for a chosen user ("why can Dana see this?") (PRD §7). Changes take effect immediately — no "pending" state (PRD §7). |
| C4 | Recycle bin | P0 | Deleted docs with remaining retention (default 30 d); restore / purge early (PRD §8). Purge is the product's most destructive action — typed confirmation. |
| C5 | Tenant analytics | P1 | Knowledge-gap dashboard: aggregated **anonymized** not-found queries (PRD §11 — no user attribution in UI); usage overview: storage, OCR, chat activity (PRD §11). |
| C6 | Audit log | P0 | Read-only, filterable, exportable; tenant-segregated by construction (PRD §12). Raw query text visible only here, not in analytics (PRD §12). |
| C7 | Tenant settings | P1 | Default UI language (PRD §2); OCR policy: per-user enable + monthly page quotas, Classic-only enforcement tenant-wide or per user (PRD §9); chat-history retention (PRD §14). |

### D. Smart OCR standalone edition

| # | Screen | Pri | Purpose / key requirements |
|---|---|---|---|
| D1 | Personal directory | P0 | Only the user's own files (sec §3.6). Each file: **remaining-time countdown to 7-day hard deletion** (PRD §15), download original + OCR output (unlimited during window), manual delete. Retention policy stated at upload and on the list (PRD §15). No sharing affordances exist at all (PRD §15). |
| D2 | Upload (OCR-E) | P0 | B4 minus folder selection; engine choice + quota semantics identical (PRD §15 → §9). |
| D3 | Processing queue | P0 | Same as B5 (PRD §15). |
| D4 | OCR-E admin | P0 | Users, quotas, engine enforcement, per-user/tenant metering (files, pages, tokens — PRD §15). **No navigation path to any user's file contents** (sec §3.5) — the admin UI has no file browser at all. |

### E. Platform-admin portal (separate app/realm — sec §2)

| # | Screen | Pri | Purpose / key requirements |
|---|---|---|---|
| E1 | Platform login | P0 | Distinct realm/cookie, TOTP mandatory, idle 15 min (sec §2). |
| E2 | Tenant lifecycle | P0 | Create/configure/suspend/offboard; quotas, feature toggles, edition, Advanced-OCR token cap, chat token budget (PRD §5, §9, §10). Offboarding flow: export → verified deletion → certificate (PRD §14) — multi-step, resumable, destructive-confirm. |
| E3 | Cross-tenant analytics & billing | P1 | Per-tenant + platform-wide: active users, storage, queries, OCR pages, token spend; metering export (PRD §5). |
| E4 | Platform health | P1 | Queue depth per stage, error rates, provider API status (PRD §5; ADR-0003 queue metrics map here). |

## 5. Cross-screen flows (the moving pieces)

Fat-marker level — each flow ≤ 10 pieces; these are the flows to prototype first:

1. **Upload → indexed:** B4 validate → queue visible in B5 → status chip flips in B2/B3 → searchable in B6/B7. Failure branch: B5 shows sanitized reason → retry.
2. **Ask → cited answer:** B6 question → streaming answer → citation click → permission re-check → B3 (or not-found state). Budget-exhausted branch → B7.
3. **Permission change propagates:** C3 grant/revoke → immediately affects B2 visibility, B6 retrieval scope, B8 hiding (PRD §7).
4. **OCR-E lifecycle:** D2 upload (quota gate) → D3 → D1 download → day-7 automatic disappearance (PRD §15).
5. **Onboarding:** A1 → A3 (enroll) → A4 (ToS) → B1, entirely on mobile Safari as the acid test (PRD §13).

## 6. Open questions (for review, not blockers)

1. Dark mode in MVP? (Samsung Internet forced-dark quirks make "no, but don't break under forced dark" a valid answer — sec §11.)
2. B7 search: separate page vs. palette-style overlay — decide in prototype.
3. Tenant admin quota banner (B1) vs. email-only alerts (PRD §4 requires alerts at 80/95% — channel split TBD).
4. Hebrew-only MVP for platform-admin portal (E*) — operators are internal; English-only is probably cheaper and acceptable.

## 7. Next steps

1. Owner review of inventory + priorities (this doc).
2. Code prototypes with mock data, in flow order §5.1–§5.5, RTL-first — after ADR-0009 fixes the repo layout.
3. Screens spec v02 folds in prototype learnings; visual design decisions recorded there, not here.
