# Review of requirements_v01.md — Proposed Changes & Additions

Date: 2026-07-07 · Reviewer: Claude (session review) · Status: RESOLVED — decisions logged below, incorporated into requirements_v02.md

## 1. Critical gaps (likely to change architecture)

### 1.1 Language support (Hebrew/RTL) — biggest omission
The document types (assembly decisions, protocols, Israeli compliance context) strongly imply Hebrew-first content, yet language is never mentioned. This affects nearly every component:
- **OCR**: engine must support Hebrew (rules out many defaults; Tesseract Hebrew is weak, Google Vision / Azure AI Vision / AWS Textract vary).
- **Embeddings**: model must handle Hebrew well (multilingual models needed; quality varies a lot).
- **BM25 keyword search**: needs Hebrew tokenization/stemming (niqqud, prefixes like ו/ה/ב).
- **UI**: RTL layout, Hebrew localization — should be stated alongside WCAG 2.1 AA.
- **Chat answers**: respond in the user's query language? Always Hebrew? Mixed corpora?

**Proposed addition**: New section "Language & Localization" specifying supported document languages, UI languages, RTL support, and answer-language behavior.

### 1.2 LLM & embedding provider strategy + data privacy
No mention of which LLM/embedding provider, or whether tenant documents may leave the deployment boundary. This is a compliance decision, not just technical:
- SOC 2 + Israeli PPL: sending document content to a third-party LLM API requires DPA coverage, sub-processor disclosure, and possibly data-residency constraints.
- Cost control: no per-tenant/per-user LLM usage quotas or rate limits are specified — chat is effectively unmetered spend.

**Proposed addition**: Section specifying LLM/embedding provider(s), zero-retention/DPA requirements, region constraints, and per-user + per-tenant rate limits & token budgets.

### 1.3 Tenant isolation model unspecified
"Strict Tenant Isolation" is stated as an outcome, but the model isn't chosen: shared DB with tenant scoping vs schema/DB-per-tenant; vector store namespace/collection-per-tenant; per-tenant encryption keys? Also unspecified: tenant URL model (subdomain vs path vs single domain), and who provisions tenants (no platform/super-admin role exists in the doc).

**Proposed addition**: Specify isolation model for DB, vector index, and object storage; add a "Platform Administration" section (tenant provisioning, suspension, platform-level ops role).

### 1.4 Non-functional requirements missing entirely
SOC 2 "Availability" is cited but no targets exist. Missing: uptime SLA, query latency targets (chat p95), document ingestion time expectations, backup/DR with RPO/RTO, capacity ceilings beyond the per-tenant numbers, browser support matrix, mobile responsiveness.

**Proposed addition**: NFR section with concrete targets, even rough MVP-grade ones.

## 2. Internal contradictions / underspecified behavior

| # | Issue | Location | Proposal |
|---|-------|----------|----------|
| 2.1 | "Version Control" heading, but behavior is hard-replace with purge — that's no version control. Decide: retain version history (with only latest indexed) or true replace. | §6 | Rename or redesign; if history retained, define who can view/restore old versions and how quota counts them. |
| 2.2 | Hard delete by any user with edit access conflicts with audit/compliance instincts — no soft-delete window, no admin-only restriction, no legal-hold concept. | §6 | At minimum: admin-configurable recycle-bin/retention window; log content hash in audit trail. |
| 2.3 | Chat logs full search queries per user (§9 audit) while queries may contain personal data — PPL tension. Define audit-log access control, retention period (2017 regs suggest ≥24 months for security events), and whether the knowledge-gap dashboard anonymizes queries. | §9 | Specify retention, access roles, and anonymization for analytics vs audit. |
| 2.4 | SMS MFA: NIST 800-63B discourages SMS OTP; it also adds per-message cost and an SMS-provider dependency (Israeli numbers). Consider TOTP-first with SMS as fallback, or drop SMS for MVP. | §4 | Decide MFA channel priority; specify enrollment & recovery flows (backup codes, admin reset). |
| 2.5 | Permission changes vs live data: what happens to favorites, open chat sessions, and cached citations when a user loses folder access or a doc is deleted? | §5/§8 | Specify: citations/links must re-check permission at click time; favorites pointing to inaccessible items are hidden. |

## 3. Missing functional requirements (smaller, but should be in v02)

- **User lifecycle**: deactivate/offboard users, password policy & reset flow, session duration/idle timeout (2017 security regs require defined session controls), account lockout.
- **Group management**: §5 grants permissions to "groups" but nothing defines creating/managing groups.
- **Folder operations**: hierarchy depth, move/rename folders & documents, permission inheritance rules for nested folders (this is a classic source of ambiguity — spell it out).
- **Upload constraints**: max file size, bulk upload, duplicate handling, malware scanning (SOC 2 expectation), password-protected/corrupt file handling.
- **OCR edge cases**: behavior when monthly quota is exhausted mid-document; are image files without OCR searchable at all (presumably not — say so); who pays/owns quota when a doc is shared.
- **Chat session management**: retention of conversation history, user ability to delete conversations, number of retained sessions.
- **Notifications/email**: user invitations, quota alerts (§3 requires alerting but no channel exists), OCR completion — implies a transactional email requirement.
- **ToS/Privacy versioning**: re-acceptance flow when documents change (§4 covers first login only).
- **Tenant offboarding**: full data export + verified deletion on contract end (PPL + SOC 2 confidentiality).

## 4. Suggested structure for v02

Keep §1–§9, add: §10 Language & Localization, §11 Platform Administration, §12 Non-Functional Requirements, §13 AI/LLM Provider & Cost Controls, §14 Data Retention & Offboarding. Fold §2 fixes (audit retention, session policy) into existing sections.

## 5. Open questions for product owner

1. Document/UI language: Hebrew-first, bilingual, or English? (drives OCR, embeddings, search, RTL)
2. LLM strategy: managed API (e.g., Claude/OpenAI with DPA) vs regional/self-hosted for compliance?
3. Tech stack & hosting (incl. data residency region)?
4. Document versions: retain history or true hard-replace?
5. Is there a platform-level (super-admin) console in MVP scope?
6. MFA: keep SMS, or TOTP-only for MVP?

## Resolution log (2026-07-07, product owner decisions)

| Question | Decision |
|----------|----------|
| Language | Hebrew-first documents, bilingual UI (Hebrew RTL primary, English secondary) |
| LLM strategy | Managed API with zero-retention DPA (e.g., Claude for chat, multilingual embedding API); disclosed sub-processors |
| Tech stack | NestJS API + MongoDB Atlas (metadata + Vector Search + Atlas Search) + Next.js frontend; BullMQ/Redis for async pipelines |
| Hosting/residency | EU region acceptable (approved transfer destination under Israeli regs); Israel region not required for MVP |
| Versioning | Retain version history — only latest version indexed for search; prior versions viewable/restorable with edit access; counts against quota |
| Platform admin | Full admin portal in MVP (tenant provisioning/suspension, quotas, cross-tenant usage analytics, billing hooks) — flagged as largest discretionary scope item |
| MFA | TOTP only for MVP (authenticator app + backup codes + admin reset); SMS deferred |
| OCR vendor note | AWS Textract lacks Hebrew — use Google Cloud Vision or Azure AI Vision (Read) |
