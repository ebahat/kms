# Product Requirements Document: Multi-Tenant RAG Knowledge Base — v02

Status: DRAFT for review · Date: 2026-07-07
Supersedes: `requirements_v01.md` · Review & decision record: `requirements_review_v01.md`

## 1. Product Overview

A secure, multi-tenant internal knowledge management and chat application that stores, processes, and answers questions over organizational documents (agreements, assembly decisions, protocols, reports) for the Israeli market.

**MVP scale targets:** 20 independent tenants; ~200 documents, 1 GB storage, and up to 400 active users per tenant.

**Editions:** The product is sold in two editions:
* **Knowledge Base edition** — the full system described in this document (documents, folders, RBAC, hybrid search, AI chat, OCR).
* **Smart OCR standalone edition** — an organization may purchase only the Smart OCR module, with per-user private directories, one-week file retention, and usage-based metering. See §15.

## 2. Language and Localization

* **Document languages:** Hebrew-first; English documents fully supported. Mixed-language documents must be handled by ingestion, search, and OCR.
* **UI languages:** Hebrew (default, full RTL layout) and English (LTR). Users can switch language; tenant admins set the tenant default.
* **Chat answers:** Responses are generated in the language of the user's query, regardless of source-document language.
* **Search:** Both semantic and keyword search must work for Hebrew queries, including tolerance for common Hebrew prefixes (ו/ה/ב/ל) via tokenizer normalization. Full morphological stemming is out of MVP scope; exact-term matching (dates, protocol numbers, names) is the priority.
* **OCR:** Both OCR engines (§9) must support printed Hebrew and English. (Vendor note: for Classic OCR, AWS Textract lacks Hebrew — Google Cloud Vision or Azure AI Vision; for Advanced OCR, the vision LLM must be validated for Hebrew extraction quality.)

## 3. Compliance and Security Standards

> Detailed security considerations and requirements — threat model, tenant-isolation architecture, LLM/RAG-specific threats, SDLC gates, and the 2017-regulations obligations checklist — are specified in `docs/security_requirements_v01.md`. This section states the headline standards.

* **SOC 2 Type II:** Architecture, development lifecycle, and operations must adhere to the Security, Availability, and Confidentiality Trust Services Criteria.
* **Israeli Privacy Protection Law (PPL):** The system must facilitate compliance for personal data embedded in organizational documents, including data-subject deletion requests (see §14).
* **Israeli Data Security Regulations (2017):** Medium-to-high security level database requirements: strict access management, robust logging, encryption, and defined session controls.
* **Accessibility:** WCAG 2.1 Level AA, in both RTL and LTR layouts, per Israeli equal-rights regulations.
* **Encryption:** AES-256 at rest, TLS 1.3 in transit.
* **Session policy:** Configurable idle timeout (default 30 minutes) and absolute session lifetime (default 12 hours). Account lockout after repeated failed logins with admin unlock.
* **Malware scanning:** All uploaded files are scanned before ingestion; infected files are rejected and the event is audited.
* **Data residency:** All tenant data (database, vector index, object storage, backups) resides in an EU region — an approved transfer destination under Israeli data-transfer regulations. Sub-processors (LLM/embedding/OCR APIs) operate under zero-retention DPAs and are disclosed in the privacy policy.

## 4. Multi-Tenancy and Data Isolation

* **Isolation model:** Single shared MongoDB Atlas cluster with mandatory `tenantId` scoping enforced at the data-access layer (repository level — no query may execute without a tenant scope). Vector and keyword search indexes are tenant-filtered on every query. Object storage uses per-tenant prefixes with per-tenant access policies.
* **Strict isolation guarantee:** A user in one tenant must never be able to query, search, or view documents, users, chat history, or metadata belonging to another tenant. Cross-tenant isolation must be covered by automated tests.
* **Tenant customization:** Tenant organization name and logo displayed in the UI; tenant-default UI language.
* **Storage quotas:** Knowledge Base edition: default 1 GB per tenant (configurable per tenant by the platform admin); tenant admins are alerted at 80% and 95% usage; version history counts against quota. Smart OCR edition: no tenant storage quota — storage is naturally bounded by the 7-day retention (§15) and per-user page quotas (§9).

## 5. Platform Administration (Super-Admin Portal)

A platform-level admin portal, separate from tenant UIs, restricted to platform operators with its own strong authentication (TOTP mandatory):

* **Tenant lifecycle:** Create, configure, suspend, and offboard tenants; set per-tenant storage quotas and feature toggles.
* **Cross-tenant analytics:** Usage dashboards (active users, storage, query volume, OCR consumption, LLM token spend) per tenant and platform-wide.
* **Billing hooks:** Per-tenant usage metering exported for billing (integration itself may be post-MVP; the metering data must exist from day one).
* **Platform health:** Ingestion queue depth, error rates, provider API status.
* **Audit:** All platform-admin actions are audited (see §12).

## 6. User Management and Authentication

* **Internal identity management:** The system manages its own user directory; no external corporate IdP dependency in MVP.
* **Authentication and MFA:** All logins enforce MFA via authenticator app (TOTP). Each user receives one-time backup codes at enrollment. Tenant admins can reset a user's MFA enrollment. SMS-based MFA is deferred beyond MVP.
* **Password policy:** Minimum length and breach-list checking; self-service password reset via verified email.
* **User lifecycle:** Tenant admins can create, deactivate, and reactivate users. Deactivation immediately revokes all active sessions. Offboarded users' personal artifacts (favorites, chat history) are retained per tenant retention policy (§14).
* **Onboarding:** On first login, users must accept the Terms of Service and Privacy Policy. When ToS/Privacy documents are updated, users must re-accept on next login; acceptance events (version, timestamp) are recorded.
* **Bulk administration:** Tenant admins can create users manually or via CSV/Excel import with per-row validation and an import error report.
* **Email notifications:** The system sends transactional email for invitations, password reset, quota alerts, and OCR completion. (Implies a transactional email provider as a sub-processor.)

## 7. Role-Based Access Control (RBAC)

* **Roles:** Platform admin (§5), tenant admin, and tenant user.
* **Groups:** Tenant admins can create and manage user groups; permissions can be granted to users or groups.
* **Folder-level permissions:** Read or edit permission per folder, assignable to users or groups.
* **Inheritance:** Subfolders inherit parent permissions by default; an explicit permission set on a subfolder overrides inheritance. The effective permission for a user is the union of direct and group grants.
* **Public folders:** Tenant-wide folders readable by all users in the tenant.
* **Permission changes take effect immediately:** Retrieval, citation links, and downloads re-check permission at access time. Favorites pointing to items the user can no longer access are hidden (not deleted).
* **Favorites:** Users can mark folders and documents as personal favorites for quick access.

## 8. Document Management and Lifecycle

* **Supported formats:** PDF, DOCX, JPG, PNG. Maximum file size: 50 MB (configurable). Corrupt or password-protected files are rejected with a clear user-facing error.
* **Folders:** Nested folder hierarchy (maximum depth 10). Folders and documents can be renamed and moved; moving a document re-applies the destination folder's permissions.
* **Metadata:** Upload date, creator, folder association, file size, version number, and processing status for every document.
* **Version history:** Uploading a new version creates a new version record; prior versions are retained and count against quota. **Only the latest version is indexed for search/chat** — superseded vectors are purged from the index immediately on new-version ingestion. Users with edit access can view and restore prior versions (restore creates a new latest version).
* **Document actions:**
  * Read access → view, download original source files (any retained version).
  * Edit access → upload new versions, move, rename, delete.
* **Deletion:** Deleting a document removes it from the search index immediately and moves it to a tenant recycle bin for a configurable retention window (default 30 days), after which the source file, all versions, metadata, and indexed data are permanently purged. Tenant admins can restore from or purge the recycle bin early. All deletions are audited with a content hash.
* **Ingestion pipeline:** Parsing, chunking, embedding, and indexing run asynchronously with per-document status (queued / processing / indexed / failed) visible to the uploader. Failures surface an actionable error and are retryable.

## 9. Personal OCR Module

* **Asynchronous processing:** Text extraction from scanned documents and images runs in the background via the ingestion queue.
* **Language support:** Printed Hebrew and English (see §2).
* **Engine choice:** Two OCR engines are offered per job:
  * **Classic OCR** — traditional OCR service (billed per page).
  * **Advanced OCR** — LLM-based (vision model) extraction; better on messy scans and complex layouts, metered in input/output tokens.
  The user selects the engine per upload; the tenant admin can enforce Classic OCR only for the tenant or for individual users.
* **Usage metering:** The system records, per user and per tenant: files uploaded, pages processed, and (for Advanced OCR) input/output tokens consumed. Metering feeds the platform analytics and billing hooks (§5); pricing model proposal: `docs/pricing_model_v01.md` (draft, pending validation).
* **Advanced OCR spend cap:** The platform admin can set a per-tenant monthly token cap for Advanced OCR. When the cap is reached, new Advanced jobs are rejected with a clear message and the user may re-submit with Classic OCR; already-queued jobs complete.
* **User-level quotas:** Tenant admins can toggle OCR per user and set monthly page quotas. When a quota would be exceeded mid-document, the document is not partially processed: the job is rejected up front with a clear message stating pages required vs. remaining.
* **Non-OCR images:** Image files uploaded by users without OCR enabled are stored and downloadable but are not text-searchable; the UI must state this.
* **Progress indication:** Users see a personal processing queue with per-document status and quota consumption (used/remaining pages this month).

## 10. AI Chat and Search Experience

* **Hybrid search:** Semantic vector search combined with keyword search (BM25) so exact terms — dates, protocol numbers, names — rank correctly alongside semantic matches.
* **Providers:** Chat generation and embeddings use managed LLM APIs under zero-retention DPAs (disclosed sub-processors). Embedding model must be multilingual with strong Hebrew performance.
* **Conversational interface:** Natural-language chat with per-user conversation history. Users can view, resume, and delete their past conversations. Responses stream incrementally.
* **Strict grounding:** Responses are limited to ingested document content. If the answer is not in the accessible corpus, the system explicitly says the information was not found (this event feeds §11 analytics).
* **Mandatory citations:** Every response includes inline citations linking to the source documents and, where applicable, specific pages. Citation links re-verify the user's read permission at click time.
* **Permission enforcement:** Retrieval only touches documents in folders where the querying user has read access, enforced in the retrieval query itself (not post-filtered).
* **Suggested prompts:** After each answer, 2–3 contextual follow-up questions are offered.
* **Cost controls:** Per-user rate limits (default: 30 messages/hour) and per-tenant monthly token budgets (configurable by platform admin). When a tenant budget is exhausted, chat degrades gracefully with a clear message; search remains available. Usage is metered per tenant for §5 analytics/billing.

## 11. Analytics and Auditing (Tenant-Level)

* **Knowledge-gap dashboard:** Tenant admins see aggregated, **anonymized** frequent queries that returned "not found," highlighting missing organizational knowledge. Queries are not attributable to individual users in this dashboard.
* **Usage overview:** Tenant admins see storage consumption, OCR usage, and chat activity for their tenant.

## 12. Audit Trail

* **Coverage:** Login/logout and failed attempts, MFA events, user/group/permission changes, search queries, chat sessions, OCR usage, document view/upload/download/move/version/delete/restore, admin actions (tenant and platform level).
* **Properties:** Immutable (append-only), strictly segregated by tenant, SOC 2 compliant.
* **Retention:** Minimum 24 months for security events (per the 2017 Data Security Regulations); configurable up to tenant policy.
* **Access:** Tenant admins can view their tenant's audit log (read-only, exportable). Raw query text in audit logs is restricted to security-audit access, distinct from the anonymized analytics in §11.

## 13. Non-Functional Requirements

* **Availability:** 99.5% monthly uptime target for MVP.
* **Performance targets (p95):** Chat first token < 5 s; search results < 2 s; document ingestion (non-OCR, ≤ 50 pages) indexed within 10 minutes of upload.
* **Backup & DR:** Daily encrypted backups; RPO ≤ 24 h, RTO ≤ 8 h for MVP. Backups remain in the EU region and are covered by the same isolation guarantees.
* **Platform & browser support:** Desktop — macOS and Windows: latest two versions of Chrome, Edge, Safari (macOS), Firefox. Mobile — Android: Chrome and Samsung Internet (latest two versions); iOS/iPadOS: Safari (latest two major iOS versions). The full user experience (login/TOTP, upload, chat, download, RTL) must work on all supported mobile browsers — responsive web, native apps out of scope. Samsung Internet and iOS Safari are explicit QA targets.
* **Scalability ceiling for MVP:** 20 tenants / 8,000 total users / ~4,000 stored documents (Knowledge Base edition); OCR throughput assumption of up to 50,000 pages/month platform-wide across both editions. Architecture must not preclude 10× growth but need not be pre-provisioned for it.

## 14. Data Retention and Tenant Offboarding

* **Tenant offboarding:** On contract end, the platform admin can trigger a full tenant export (source files + metadata + audit logs in open formats), followed by verified deletion of all tenant data — database records, vectors, object storage, and expiring from backups within the backup retention window. A deletion certificate is produced. For Smart OCR edition tenants, the export covers metering and audit data; any not-yet-expired files are purged immediately at offboarding.
* **Data-subject requests (PPL):** Tenant admins can locate and delete documents containing a data subject's personal data (standard document deletion, §8); user account data can be erased on request after deactivation.
* **Chat history retention:** Default 12 months, configurable per tenant.

## 15. Smart OCR Standalone Edition

An organization may purchase only the Smart OCR module, without the Knowledge Base edition. In this edition:

* **Scope:** Strictly upload → OCR → download. Folders (beyond the personal directory), sharing, public folders, hybrid search, and AI chat are disabled. Files in this edition are **never** added to any vector or keyword search index.
* **Per-user isolation:** Each user has a single private directory and can access only files they uploaded themselves. There is no sharing between users. The tenant admin manages users, quotas, and engine policy, and sees usage metering — but has no access to users' file contents.
* **Processing:** Files are uploaded and processed asynchronously exactly as in §9, including engine choice (Classic / Advanced, subject to admin enforcement), language support, quotas, and the personal processing-queue UI.
* **Retention — one week:** Every file (original **and** its OCR output) is permanently deleted exactly 7 days after upload. Deletion is hard (no recycle bin), automatic, and audited. The UI shows each file's remaining time; users are informed of the policy at upload. Users may also delete their files manually before expiry.
* **Downloads:** During the retention window the user can download both the original file and the OCR output, an unlimited number of times.
* **Usage metering for pricing (proposal: `docs/pricing_model_v01.md`):** Per user and per tenant, the system tracks: number of files uploaded, number of pages processed, and input/output tokens consumed by the Advanced (LLM-based) OCR engine. Metering data is retained independently of the files themselves (it survives the 7-day deletion) and is exported via the §5 billing hooks.
* **All platform-level requirements apply:** compliance and encryption (§3), tenant isolation (§4), authentication and MFA (§6), audit trail (§12), and NFRs (§13).

## 16. Technical Architecture Decisions (from review)

Recorded here for traceability; details in `requirements_review_v01.md` resolution log.

| Area | Decision |
|------|----------|
| Backend | NestJS (Node.js), Mongoose data layer |
| Frontend | Next.js (RTL-first, bilingual) |
| Data & search | MongoDB Atlas — collections + Atlas Vector Search + Atlas Search (keyword), tenant-filtered |
| Async pipeline | BullMQ + Redis workers (ingestion, OCR, embedding) |
| LLM / embeddings | Managed APIs with zero-retention DPA; multilingual embedding model |
| OCR | Classic: Google Cloud Vision or Azure AI Vision (Hebrew support required). Advanced: vision LLM (e.g., Claude) under zero-retention DPA, token-metered |
| Hosting | EU region; cloud provider finalized at infrastructure planning |
| MFA | TOTP + backup codes (SMS deferred) |
