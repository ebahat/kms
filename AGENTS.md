# Multi-Tenant RAG Knowledge Base (working dir: `crm`)

Multi-tenant knowledge management + AI chat over organizational documents for the Israeli market (Hebrew-first). **Not a classic CRM** despite the directory name.

## Project status

Architecture phase complete, pre-implementation — no application code yet (git repo initialized). All artifacts live in `docs/`. The ADR pass (`docs/plans/architecture-adr-pass-07-07-2026-plan.md`) is COMPLETE: ADRs 0001–0009 **Accepted** (0008 gated on the Hebrew benchmark).

## Documents (read in this order)

| File | What it is |
|---|---|
| `docs/requirements_v02.md` | **Authoritative PRD** — two editions (Knowledge Base + standalone Smart OCR), 16 sections. Supersedes `requirements_v01.md` (root, historical). |
| `docs/requirements_review_v01.md` | Review of v01 + **resolution log of owner decisions** (2026-07-07) — check before reopening any settled decision |
| `docs/security_requirements_v01.md` | Security spec — threat model, tenant-isolation architecture, LLM/RAG threats, Israeli 2017-regs obligations, MVP acceptance checklist |
| `docs/adr/` | **Accepted ADRs 0001–0009**: tenant scoping, Atlas data/index design, ingestion pipeline (ClamAV in-VPC), auth/sessions (Redis, separate portal realm), RBAC resolution (cached on-read), GCS storage/signed URLs, GCP Cloud Run topology, Vertex AI providers (gated on Hebrew benchmark), pnpm/Turborepo monorepo + edition gating |
| `docs/architecture/system-overview.md` | Container + data-flow Mermaid diagrams, sec-§12 traceability table, future-ADR list (FINAL for the ADR pass) |
| `docs/test_plan_v01.md` | Test plan — security tests, LLM eval plan (datasets/thresholds), upgrade & maintenance process |
| `docs/security_audit_plan_v01.md` | Audit program — CI gates (Snyk/gitleaks), AI-assisted review, quarterly deep audits, pentest/SOC 2 cadence |
| `docs/ui/screens_spec_v01.md` | Screen inventory (P0/P1/P2), roles, states, RTL/security constraints; mockups artifact linked from session notes |
| `docs/analytics/posthog_analytics_v01.md` | PostHog proposal — EU cloud, event taxonomy (no content/query text), dashboards, tenant-group flags |
| `docs/pricing_model_v01.md` | Pricing proposal (DRAFT — price points are placeholders pending WTP validation) |

## Key settled decisions

- **Stack:** NestJS + Mongoose + MongoDB Atlas (Vector Search + Atlas Search) + Next.js; BullMQ/Redis workers for ingestion/OCR
- **Hebrew-first**, bilingual UI (RTL default); managed LLM/embedding APIs under zero-retention DPA; EU data residency (Israel region NOT required)
- **OCR:** user-selectable Classic (Google Vision/Azure — AWS Textract lacks Hebrew) or Advanced (vision LLM, token-metered); admin can enforce Classic-only
- **Compliance targets:** SOC 2 Type II, Israeli PPL, Israeli Data Security Regulations 2017
- **Security invariants:** tenantId injected at repository layer (never from request input); cross-tenant test suite on every PR; httpOnly-cookie sessions (no JWT in localStorage); files served only via short-lived signed URLs; chat markdown renderer blocks remote loads

## Next steps

1. Phased implementation plan (first tasks per ADR-0009: scaffold monorepo + lint guards + CI before feature code)
2. Author Hebrew golden datasets and run the ADR-0008 benchmark gate (blocks final provider commitment)
3. WTP interviews + real Hebrew-document token measurements before finalizing pricing
