# Product Analytics Proposal — PostHog — v01

Date: 2026-07-10 · Status: DRAFT for review
Sources: `docs/requirements_v02.md` (PRD §5, §11, §12), `docs/security_requirements_v01.md` (sec §5.6, §7.6, §9), `docs/ui/screens_spec_v01.md` (screen IDs referenced below)
Principle: **measure decisions, not everything** — every event below feeds a named dashboard question. PostHog is the *product analytics* layer; billing/metering truth stays in the `usageEvents` collection (ADR-0002), and tenant-facing knowledge-gap analytics (PRD §11) stays in-product — PostHog never receives query text.

## 1. Hosting, privacy, and hard rules

| Decision | Choice | Why |
|---|---|---|
| Instance | **PostHog EU Cloud** (`eu.i.posthog.com`) | EU data residency (PRD §3); DPA signed and PostHog added to the sub-processor register (sec §9) |
| Identity | `distinct_id` = internal opaque `userId`; person properties limited to `role`, `edition`, `uiLanguage`, `createdAt` | No names/emails in analytics — PPL data-minimization; users are identifiable internally when needed via userId |
| Tenancy | PostHog **group analytics**, group type `tenant` (opaque tenantId + plan/edition/seat-count properties) | Per-tenant slicing for all dashboards; mirrors platform-admin analytics needs (PRD §5) |
| Autocapture | **OFF** | Autocapture harvests element text/attributes — filenames and document titles are sensitive (sec) |
| Session replay | **OFF** | Would record document content wholesale — prohibited |
| Event payloads | Custom events only, schema-reviewed; **never**: query text, answer text, chunk text, filenames, document titles, folder names | PRD §12 confines raw query text to the tenant audit log; sec §5.6 minimization applies to analytics sub-processors too |
| Capture path | **Server-side first** (`posthog-node` from the NestJS API/workers) for all business events; `posthog-js` client only for pageviews + UI-interaction events, `person_profiles: 'identified_only'` | Server events are tamper-proof and keep payload control in reviewed code; client SDK stores only its own anonymous id (no auth tokens — consistent with sec §7.6) |
| CSP | Add `eu.i.posthog.com` to `connect-src` only | Keeps the strict CSP posture (sec §4.7) |

Schema enforcement: a single `analytics.service.ts` wraps all captures with typed event definitions; the property sanitizer strips any key not on the event's allowlist. New events = PR-reviewed schema change. (This service is also where the test plan's payload-minimization assertions point.)

## 2. Event taxonomy

`object_action` snake_case, past tense. All events carry `tenantId` (group), `edition` (`kb` | `ocr`), `uiLanguage` (`he` | `en`), and `platform` (`desktop` | `mobile`).

### 2.1 Auth & activation (screens A1–A5)

| Event | Key properties | Feeds |
|---|---|---|
| `user_logged_in` | `mfaMethod` (totp/backup_code) | DAU/WAU/MAU |
| `onboarding_completed` | `durationSeconds` (A1→A3→A4→B1 flow) | Activation funnel |
| `totp_enrollment_completed` / `_abandoned` | abandonment step | Onboarding friction |
| `password_reset_requested` / `_completed` | — | Support-load signal |

### 2.2 Knowledge Base usage (screens B1–B8)

| Event | Key properties | Feeds |
|---|---|---|
| `document_upload_started` / `_completed` / `_rejected` | `fileType`, `sizeBucket`, `ocrEngine` (none/classic/advanced), `rejectReason` (type/size/quota/corrupt) | Ingestion funnel |
| `document_indexed` / `document_failed` (server, from index/DLQ stage) | `durationBucket`, `stageFailed`, `pagesBucket` | Ingestion health, p95 vs PRD §13 |
| `search_performed` | `queryLanguage`, `resultCountBucket`, `hadExactTermHit` — **no query text** | Search engagement |
| `search_result_opened` | `rankBucket` | Search quality proxy |
| `chat_message_sent` | `conversationIsNew`, `queryLanguage` | Core engagement |
| `chat_answer_completed` | `outcome` (`grounded` \| `not_found` \| `budget_blocked` \| `error`), `citationCount`, `firstTokenMsBucket`, `answerLanguage` | **North-star + RAG quality** |
| `chat_citation_clicked` | `rankInAnswer` | Citation utility (PRD §10) |
| `chat_followup_clicked` | — | Follow-up feature value |
| `chat_feedback_given` | `verdict` (up/down) — thumbs UI to add to B6 | Quality proxy; complements offline evals (test plan §4) |
| `rate_limit_hit` / `budget_exhausted_shown` | `surface` (chat/upload/ocr) | Plan-fit and pricing signals |
| `favorite_added` / `favorite_opened` | `itemType` | B8 P1 justification |

### 2.3 Admin & OCR edition (screens C1–C7, D1–D4)

| Event | Key properties | Feeds |
|---|---|---|
| `user_imported_csv` | `rowCountBucket`, `errorRowCountBucket` | C1 UX quality |
| `permission_changed` | `grantType`, `targetType` (user/group) — no folder names | Admin engagement |
| `recycle_bin_restored` / `_purged` | — | Destructive-action monitoring |
| `ocr_file_uploaded` / `ocr_output_downloaded` | `engine`, `pagesBucket` | OCR-E core funnel |
| `ocr_quota_blocked` | `pagesRequestedBucket` | Upsell/quota-tuning signal |
| `admin_analytics_viewed` / `audit_log_exported` | — | C5/C6 value check |

### 2.4 Errors

`client_error_shown` (`errorClass`, `screen` — sanitized classes only, never provider/parser internals per sec §8.2). Server-side error *rates* stay in the observability stack (ADR-0007), not PostHog; this event only measures **user-visible** failure exposure.

## 3. Dashboards (the questions we're paying to answer)

1. **North star:** weekly users receiving ≥ 1 *grounded, cited* answer (`chat_answer_completed{outcome=grounded}`), per tenant and platform-wide. This is the product's value moment.
2. **Activation (per new tenant):** onboarding funnel → first upload → first `document_indexed` → first grounded answer, target ≤ 14 days; drop-off step highlighted. Answers "does a new tenant reach value?"
3. **RAG quality proxies (trend):** `not_found` rate, citation CTR, feedback down-rate, `firstTokenMsBucket` p95 — drift here triggers the eval error-analysis loop (test plan §4.7); the not-found rate is the MVP online signal named in test plan §4.8.
4. **Ingestion health:** upload→indexed conversion, failure reasons, duration buckets vs the 10-min p95 (PRD §13); reject-reason mix (quota vs corrupt vs type) tells us whether limits or UX are the problem.
5. **Engagement & retention:** WAU/MAU per tenant, chat-vs-search mix, weekly tenant retention cohorts; language split (he/en) and mobile share (validates the PRD §13 mobile investment).
6. **Edition & monetization signals:** OCR pages by engine, `ocr_quota_blocked` and `budget_exhausted_shown` frequency, Advanced-vs-Classic adoption — direct inputs to the pricing-model WTP work (`docs/pricing_model_v01.md`).

## 4. Feature flags & experiments

- Use PostHog **feature flags keyed on the `tenant` group** for staged rollouts: new analyzer/index cutovers (test plan §8.1 shadow-index cutover "per tenant" is executed as a flag), Advanced-OCR availability, UI experiments (e.g., B7 search-as-page vs palette — UI spec open question 2).
- Flags are evaluated **server-side** (`posthog-node`) for anything security- or cost-relevant; client-side flags only for cosmetic UI variants.
- Formal A/B experiments are post-MVP (20 tenants is too small for powered experiments); flags are for rollout safety, not statistics, until scale allows.

## 5. Implementation notes

- `posthog-node` singleton in a NestJS `AnalyticsModule`; `shutdown()` on SIGTERM; workers emit pipeline events through the same module (they already carry tenant/user scope — ADR-0003).
- Next.js: `posthog-js` init in a provider, `capture_pageview: false` with manual route-change pageviews; dev/staging → separate PostHog project; local dev opts out.
- E2e (Playwright) asserts the event schema on the five core flows using a mocked `posthog-js` (test plan §5) — analytics is code and gets happy-path tests like everything else (working rule 3).
- Buckets, not raw values, for anything cardinal (`sizeBucket`, `durationBucket`, `pagesBucket`) — keeps events cheap to slice and avoids quasi-identifier leakage.

## 6. Open items

1. Sign PostHog EU DPA; add to sub-processor register (sec §9) — blocker before any production event flows.
2. Thumbs up/down UI on chat answers (B6) — small UI-spec v02 addition; without it dashboard 3 loses its best proxy.
3. Decide whether platform-admin portal (E1–E4) is instrumented at all (internal operators; probably skip in MVP).
4. Confirm PostHog free/paid tier fit at MVP volume (~8k users, custom-events-only is well within free tier; revisit at 10×).
