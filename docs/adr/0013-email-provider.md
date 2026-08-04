# ADR-0013: Transactional Email Provider Selection

**Status:** Accepted
**Date:** 2026-08-04
**Deciders:** Product owner (Ehud); drafted from the 2026-08-04 brainstorming session
**Sources:** `docs/superpowers/specs/2026-08-04-calendar-kanban-design.md` (decision 7, decision 9, §Notifications/email); `docs/architecture/design-review-2026-07-10.md` finding 11; ADR-0007 (named-egress-endpoint pattern); ADR-0008 (provider-adapter pattern this ADR's `NotificationProvider` mirrors)

## Status

Accepted 2026-08-04. Pulled forward from the Phase 5.4 future-ADR candidate ("Transactional email provider selection", design-review finding 11) per the Phase 2A design doc's decision 7 — needed now because calendar invites and task-assignment emails are in scope for this phase, and the same provider retroactively resolves the "no transactional email provider yet" gap left open since Phase 1 (password-reset/security emails).

## Context

Phase 2A needs transactional email for two always-on triggers (event created → all other group members; task assigned → the assignee) and five preference-gated triggers (file/task lifecycle events, design doc decision 9). The same provider also finally backs Phase 1's password-reset flow, which has been implemented without a live send path since Phase 1 (root `CLAUDE.md`, "Next steps"; design doc decision 7).

Constraint (design-review finding 11, the same one ADR-0008 applied to LLM/embedding providers): any external processor must offer EU data processing and a DPA. ADR-0007 already applies a "named egress endpoint" pattern to other external providers — each provider's concrete API base URL must be pinned so it can be added to the relevant Cloud Run service's firewall/VPC egress allowlist. ADR-0007's own `api` service egress row already anticipates this, listing "email API" generically alongside Atlas PSC, Memorystore, GCS, and Vertex AI; this ADR is what pins that entry to a concrete host.

Volume is low (per-event/per-assignment sends, not bulk/marketing mail) and calls originate synchronously from `api`/`portal-api` request handlers — no dedicated worker pool or queue is needed at this scale (a BullMQ retry-queue escalation path is documented in the design doc as a deferred future enhancement, not built now).

Integration shape: a `NotificationProvider` interface, mirroring the existing `ChatProvider`/`EmbeddingProvider` adapter pattern in `libs/ai-providers` (ADR-0008), so the concrete provider stays swappable without touching call sites.

## Options Considered

### Option A: Resend (chosen)

- **API:** single endpoint, `POST https://api.resend.com/emails`, JSON body (to/from/subject/html or React-Email template).
- **Auth:** `Authorization: Bearer <RESEND_API_KEY>` — the same Bearer-token shape ADR-0008's provider adapters already use for API-key-based fallback providers (Claude, Cohere, OpenAI), so this fits the existing secret-handling pattern in `libs/ai-providers`/`libs/config` without introducing a new auth shape.
- **EU residency / DPA:** offers an EU sending region (Dublin/`eu-west-1`), selectable per sending domain at setup — must be explicitly configured, not the default region. Publishes a standard DPA (self-serve acceptance via their legal/trust pages) and holds a SOC 2 Type II report.
- **Pros:** Simplest API shape to adapt (one endpoint, Bearer auth consistent with the existing provider-adapter pattern); self-serve DPA acceptance (no sales-gated contract needed to move fast); generous free/low tier fits Phase 2A's low send volume; modern DX (React-Email templating) is a natural fit if richer templates are needed later.
- **Cons:** Newer company (founded 2023) — shorter compliance track record than Postmark; EU region is opt-in at sending-domain setup, so a misconfigured domain could default to non-EU processing — this is a setup-time checklist item, not a code-level gate (see Follow-ups).

### Option B: Postmark (ActiveCampaign)

- **API:** single endpoint, `POST https://api.postmarkapp.com/email`, JSON body.
- **Auth:** `X-Postmark-Server-Token: <token>` — a proprietary header, not a standard Bearer token, so it doesn't fit the Bearer-token shape the other provider adapters (ADR-0008) already use; the `NotificationProvider` adapter would need its own auth-header handling instead of reusing the existing pattern.
- **EU residency / DPA:** dedicated EU account/infrastructure option (Ireland-based), marketed and available for longer than Resend's EU offering. DPA available through ActiveCampaign's enterprise legal/compliance program (SOC 2 Type II, ISO 27001) — more mature audit history but typically a heavier, sales-mediated process to execute than a self-serve click-through.
- **Pros:** Longer-established (since 2010), strong deliverability reputation, more mature enterprise compliance program.
- **Cons:** Non-Bearer auth header breaks the adapter-pattern consistency with ADR-0008; DPA execution is more likely to require a sales/legal touch rather than self-serve acceptance, adding friction at MVP stage for a low-volume email need.

**Decision on the fork: Option A.** Both providers clear the EU-DPA bar (design-review finding 11); at this volume and this project stage, deliverability-reputation differences aren't a differentiator, so the tie-breaker is integration fit: Resend's single-endpoint, Bearer-token API matches the auth shape `libs/ai-providers`' adapters already use, and its DPA is self-serve rather than sales-gated — both reduce the lift for Task 6's `NotificationProvider` adapter and for closing this ADR without a vendor legal cycle blocking Phase 2A.

## Decision

**Provider: Resend.**

- **Egress endpoint (for ADR-0007's allowlist):** `api.resend.com` — added to the `api` and `portal-api` Cloud Run services' egress rules (both send low-volume synchronous notification/security email; no worker-pool egress change needed). This pins ADR-0007's existing generic "email API" entry on the `api` service's egress row to this concrete host.
- **Auth:** `Authorization: Bearer <RESEND_API_KEY>` header; the key is stored in Secret Manager (sec §9 pattern) and injected the same way other provider API keys are (ADR-0008).
- **DPA / residency:** Resend's standard DPA must be accepted, and the sending domain must be explicitly configured for EU-region (`eu-west-1`) sending before any production email is sent — non-EU is the platform default absent this configuration, so it is a required setup step, not an assumption (tracked as a Follow-up below).
- **Interface:** `NotificationProvider` (`libs/ai-providers`-style adapter, per the design doc) wraps the single `POST /emails` call; Task 6 implements the concrete adapter against this shape.

## Consequences

- **Positive:** Unblocks Task 6's `NotificationProvider` adapter with a concrete, minimal API shape; retroactively closes the Phase 1 gap of having no live transactional-email path for password reset; Bearer-token auth keeps secret handling consistent with the existing `libs/ai-providers` pattern instead of introducing a new auth shape.
- **Negative / accepted risks:** Resend's compliance track record is shorter than Postmark's/ActiveCampaign's — accepted at current (low-volume, MVP) scale; revisit if a specific enterprise customer's security review requires the longer-audited vendor. EU-region sending is an explicit setup step (sending-domain configuration), not a code-enforced default — must not be skipped (see Follow-ups).
- **Follow-ups:** Pin `api.resend.com` into ADR-0007's `api`/`portal-api` Terraform egress allowlist; execute Resend's DPA and verify the sending domain is configured for EU (`eu-west-1`) processing before first production send (sec §9 annual vendor review now covers this provider); Task 6 implements the `NotificationProvider` adapter against this shape; remove "Transactional email provider selection" from `docs/architecture/system-overview.md`'s Future-ADR candidates list (resolved by this ADR).
