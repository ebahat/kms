# Plan: Architecture / ADR Pass — Multi-Tenant RAG Knowledge Base

**Status:** PENDING APPROVAL
**Date:** 2026-07-07
**Sources:** `docs/requirements_v02.md` (PRD v02), `docs/security_requirements_v01.md`, `docs/requirements_review_v01.md`
**Canonical copy:** `docs/plans/architecture-adr-pass-07-07-2026-plan.md` (mirrored in `.omc/plans/`)

## Requirements Summary

Produce the full foundation architecture pass for the KMS project (currently requirements-only, no code): individual ADR files plus one system-architecture overview document. Directional decisions captured in the planning interview:

- **Scope:** full foundation — core three (tenant scoping, Atlas index design, ingestion pipeline) + security architecture (auth/sessions, RBAC, file serving) + hosting, LLM/embedding providers, repo layout, edition gating.
- **Cloud:** lean **GCP** (europe-west region; Google Cloud Vision already a Classic-OCR candidate per PRD §2/§16).
- **LLM/embeddings:** **GCP-aligned Vertex AI** (Gemini chat + Vertex multilingual embeddings), one vendor/DPA, subject to a Hebrew-quality benchmark gate.
- **Deliverable form:** `docs/adr/NNNN-<title>.md` (standard template: Status / Context / Options Considered / Decision / Consequences) + `docs/architecture/system-overview.md` with Mermaid diagrams.

Constraints the ADRs must honor (from PRD/security spec):

- MVP scale: 20 tenants / 8,000 users / ~4,000 docs / 50k OCR pages/month; must not preclude 10× (PRD §13).
- Security invariants: tenantId injected at repository layer, never from request input (sec §3.1); search/vector pre-filtering inside the Atlas query (sec §3.3); signed-URL-only file access ≤ 5 min (sec §3.4); server-side sessions, httpOnly cookies, no JWT-in-localStorage (sec §2); sandboxed parsing workers (sec §4.4); chat renderer with no remote loads (sec §5.2); fail-closed grounding (sec §5.4).
- Hebrew-first: prefix (ו/ה/ב/ל) tokenizer normalization, exact-term matching priority over stemming (PRD §2).
- Two editions: Knowledge Base + Smart OCR standalone (per-user isolation, 7-day hard retention) (PRD §15, sec §3.6).
- EU data residency, zero-retention DPAs for all AI sub-processors (PRD §3, sec §9).

## Deliverables

| # | File | Decision area | Key content |
|---|------|--------------|-------------|
| 1 | `docs/adr/0001-tenant-scoping-mongoose.md` | Tenant isolation enforcement | Repository-layer pattern: tenant-scoped base repository vs Mongoose plugin vs both; request-context propagation (NestJS CLS/AsyncLocalStorage); compile/lint guard making unscoped queries impossible; per-user scoping reuse for Smart OCR edition (sec §3.1, §3.6); cross-tenant CI test suite hook (sec §10) |
| 2 | `docs/adr/0002-atlas-data-and-index-design.md` | Collections + Vector/Atlas Search | Core collections (tenants, users, folders, documents, versions, chunks, conversations, audit); chunk schema with `tenantId` + permission-filter fields; Atlas Vector Search index with tenant+folder pre-filter (actual query shape shown); Atlas Search analyzer for Hebrew prefixes (custom analyzer/char filters, PRD §2); latest-version-only indexing + immediate vector purge (PRD §8); audit append-only store (sec §8.1) |
| 3 | `docs/adr/0003-ingestion-pipeline.md` | Async processing | BullMQ queue/stage topology (scan → parse → chunk → embed → index); sandboxed parser workers (container, no egress, zip-bomb/XXE guards — sec §4.4); status model (queued/processing/indexed/failed, PRD §8); retries/poison handling (sec §8.3); OCR branch (Classic vs Advanced, caps/quotas PRD §9); p95 ≤ 10 min ingestion target (PRD §13) |
| 4 | `docs/adr/0004-authn-and-sessions.md` | Identity | Server-side session store (Redis) + httpOnly/SameSite cookies; Argon2id params; TOTP + backup codes with field-level encryption (sec §2, §7.2); separate platform-admin auth realm (sec §2 last bullet); lockout/enumeration-resistance mechanics |
| 5 | `docs/adr/0005-rbac-folder-permissions.md` | Authorization | Users/groups/folder grants; inheritance-with-override resolution; effective-permission computation strategy (materialized permitted-folder set vs on-read resolution) and how it feeds the retrieval pre-filter (sec §3.3, PRD §7/§10); immediate propagation; 404-not-403 policy (sec §3.2) |
| 6 | `docs/adr/0006-file-storage-and-serving.md` | Object storage | GCS bucket layout, per-tenant prefixes + IAM; streaming upload with magic-byte validation and 50 MB pre-buffer limit (sec §4.4); short-lived signed URLs (≤ 5 min, single object) with `Content-Disposition: attachment` (sec §3.4); recycle bin + deletion-verification jobs (PRD §8/§14, sec §7.3) |
| 7 | `docs/adr/0007-hosting-topology-gcp.md` | Infrastructure | GCP europe-west: Cloud Run vs GKE for API + workers; Atlas via Private Service Connect; Memorystore Redis; Cloud Armor WAF; Secret Manager + KMS; Terraform IaC; backup/DR meeting RPO ≤ 24 h / RTO ≤ 8 h (PRD §13, sec §6) |
| 8 | `docs/adr/0008-llm-embedding-providers.md` | AI providers | Vertex AI (Gemini chat, `text-multilingual-embedding` family) as primary; Hebrew benchmark gate (defined test corpus + pass criteria) before final commit; provider abstraction layer for swap-out; Advanced-OCR vision model; zero-retention/DPA verification per sub-processor (sec §5.6, §9); prompt architecture (untrusted-chunk delimiting, server-side citations, no tools — sec §5.1) |
| 9 | `docs/adr/0009-repo-layout-and-edition-gating.md` | Codebase structure | Monorepo layout (NestJS `api` + `worker`, Next.js `web`, shared libs); module boundaries mapped to PRD sections; edition gating KB vs Smart OCR (feature flags vs module composition); CODEOWNERS security-sensitive paths (sec §10) |
| 10 | `docs/architecture/system-overview.md` | Overview | Container-level diagram, ingestion data flow, chat/retrieval data flow, Smart-OCR edition flow (Mermaid); traceability table mapping security spec §12 acceptance checklist → ADR sections |

## Implementation Steps

1. `[PENDING]` Create `docs/adr/` + `docs/architecture/`; add `docs/adr/template.md` (Status/Context/Options Considered/Decision/Consequences).
2. `[PENDING]` Write ADRs 0001–0003 (core three) — invoke the `architecture` domain skill for each per global routing rules; each ADR ≥ 2 options with trade-offs, decision, consequences, and citations to PRD/security-spec sections.
3. `[PENDING]` Write ADRs 0004–0006 (security architecture).
4. `[PENDING]` Write ADRs 0007–0009 (hosting, providers, repo layout) — 0008 must define the Hebrew benchmark gate as a testable pre-commitment, not a vague "validate later".
5. `[PENDING]` Write `docs/architecture/system-overview.md` — 4 Mermaid diagrams + §12-checklist traceability table; cross-link every ADR.
6. `[PENDING]` Review pass: critic-style review of the full set for consistency with PRD/security spec and inter-ADR contradictions; apply fixes.
7. `[PENDING]` Update root `CLAUDE.md` (new `docs/adr/`, `docs/architecture/` directories; settled decisions) per global Rule 5; mark step statuses in this plan.

No application code is written in this pass; Rules 3/4 (tests, code-quality pipeline) apply to the later implementation phase, not to these documents.

## Acceptance Criteria

1. `docs/adr/` contains exactly ADRs 0001–0009 + `template.md`; every ADR has all five template sections filled.
2. Every ADR lists ≥ 2 options considered with explicit trade-offs (or an explicit invalidation rationale where only one option is viable).
3. ≥ 80% of factual claims in ADRs cite a PRD/security-spec section (e.g., "sec §3.3") or an external doc.
4. ADR-0001 shows concrete code-shape (repository/plugin interface sketch) and names the guard mechanism that fails CI on unscoped queries.
5. ADR-0002 shows the literal Atlas Vector Search filter clause combining `tenantId` + permission filter, and the Hebrew analyzer definition approach.
6. ADR-0008 contains a Hebrew benchmark gate with named datasets/method and numeric pass criteria (no "TBD" thresholds).
7. `system-overview.md` renders 4 valid Mermaid diagrams and contains a traceability table covering all 9 items of security spec §12.
8. No ADR contradicts a settled decision in `requirements_review_v01.md`; any deliberate deviation is flagged as such in the ADR.
9. Root `CLAUDE.md` updated and under 200 lines.

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Vertex multilingual embeddings underperform on Hebrew | ADR-0008 benchmark gate before commitment + provider abstraction layer; fallback candidates (Cohere embed-multilingual, OpenAI) pre-identified in the ADR |
| Atlas Search custom analyzer can't express Hebrew prefix normalization well | ADR-0002 prototypes the analyzer definition on paper against PRD §2 examples; fallback: index-time token expansion in the chunking step |
| Permission pre-filter cardinality (user's permitted-folder list) exceeds Atlas filter limits at scale | ADR-0005 evaluates materialized-set size bounds at 10× scale and documents the limit; escape hatch: permission-group tokens on chunks |
| ADR sprawl / analysis paralysis | Fixed list of 9; anything new discovered goes to a "future ADRs" list in the overview doc, not into this pass |
| Decisions contradict the (older) review resolution log | Step 6 review explicitly diffs against `requirements_review_v01.md` |

## Verification Steps

1. Checklist audit of acceptance criteria 1–9 (mechanical: file existence, section presence, citation density spot-check on 2 ADRs).
2. Mermaid syntax check (render or `mmdc`-style parse) for all diagrams.
3. Cross-reference check: every `sec §x` / `PRD §x` citation resolves to a real section; every ADR linked from the overview doc.
4. Consistency review (step 6) recorded at the end of this plan with findings + resolutions.
