# Multi-Tenant RAG Knowledge Base (working dir: `crm`)

Multi-tenant knowledge management + AI chat over organizational documents for the Israeli market (Hebrew-first). **Not a classic CRM** despite the directory name.

## Project status

Requirements phase — no code yet, no git repo initialized. All artifacts live in `docs/`.

## Documents (read in this order)

| File | What it is |
|---|---|
| `docs/requirements_v02.md` | **Authoritative PRD** — two editions (Knowledge Base + standalone Smart OCR), 16 sections. Supersedes `requirements_v01.md` (root, historical). |
| `docs/requirements_review_v01.md` | Review of v01 + **resolution log of owner decisions** (2026-07-07) — check before reopening any settled decision |
| `docs/security_requirements_v01.md` | Security spec — threat model, tenant-isolation architecture, LLM/RAG threats, Israeli 2017-regs obligations, MVP acceptance checklist |
| `docs/pricing_model_v01.md` | Pricing proposal (DRAFT — price points are placeholders pending WTP validation) |

## Key settled decisions

- **Stack:** NestJS + Mongoose + MongoDB Atlas (Vector Search + Atlas Search) + Next.js; BullMQ/Redis workers for ingestion/OCR
- **Hebrew-first**, bilingual UI (RTL default); managed LLM/embedding APIs under zero-retention DPA; EU data residency (Israel region NOT required)
- **OCR:** user-selectable Classic (Google Vision/Azure — AWS Textract lacks Hebrew) or Advanced (vision LLM, token-metered); admin can enforce Classic-only
- **Compliance targets:** SOC 2 Type II, Israeli PPL, Israeli Data Security Regulations 2017
- **Security invariants:** tenantId injected at repository layer (never from request input); cross-tenant test suite on every PR; httpOnly-cookie sessions (no JWT in localStorage); files served only via short-lived signed URLs; chat markdown renderer blocks remote loads

## Next steps

1. Architecture/ADR pass (tenant-scoping pattern in Mongoose, Atlas index design, ingestion pipeline)
2. Phased implementation plan
3. WTP interviews + real Hebrew-document token measurements before finalizing pricing
