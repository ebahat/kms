# ADR-0006: Object Storage Layout and File Serving (GCS)

**Status:** Accepted (2026-07-10)
**Date:** 2026-07-10
**Deciders:** Product owner (Ehud); drafted in the architecture/ADR pass
**Sources:** PRD §3, §4, §8, §14, §15; sec §3.4, §4.4, §7.3, §7.4; ADR-0003 (pipeline artifacts), ADR-0005 (permission check)

## Status

Accepted 2026-07-10 — step-6 consistency review passed; review fixes applied (findings record in the plan). Assumes GCP/GCS per the plan's cloud direction; bucket/IAM mechanics finalize with ADR-0007.

**Rebound 2026-08-15 by [ADR-0014](0014-hosting-topology-oci.md)** — hosting moved to OCI (ADR-0007
superseded), so the GCP-specific primitives referenced below (GCS, Cloud KMS, Secret Manager) become
OCI Object Storage, OCI Vault, and OCI Vault secrets respectively. This ADR's own decisions — bucket
layout, upload-through-the-API path, signed-URL semantics, deletion-verification machinery — are
**not** reopened; ADR-0014's "What ADR-0006 keeps vs. what rebinds" section is the authoritative map
of what changed vs. what didn't.

## Context

Object storage holds original files (all retained versions, PRD §8), OCR outputs (PRD §9/§15), pipeline stage artifacts (ADR-0003), and audit exports (sec §8.1). Constraints:

- Per-tenant prefixes with per-tenant access policies; downloads **only** via short-lived signed URLs (≤ 5 min), issued after a permission check, bound to a single object; bucket fully private (PRD §4; sec §3.4).
- Files never render inline from the app origin: `Content-Disposition: attachment` + `nosniff` (sec §4.4); filenames are untrusted display strings; objects stored under generated keys, never user paths (sec §4.4).
- Upload is streaming with magic-byte validation and the 50 MB limit enforced before buffering (sec §4.4; PRD §8).
- Deletion is verified, not assumed: recycle-bin purge (default 30 d), Smart-OCR 7-day hard expiry, tenant offboarding with deletion certificate (PRD §8, §14, §15; sec §7.3). Backups EU-region, restore-tested (PRD §13; sec §7.4).
- EU residency for all object data (PRD §3).

## Options Considered

### Option A: One bucket per environment, per-tenant key prefixes (chosen)

`kms-prod-data` with keys `tenants/{tenantId}/…`; access exclusively through the API's service account; no per-tenant IAM.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — one bucket, one CMEK key, one lifecycle policy set |
| Isolation mechanism | Application-enforced: generated keys + signed URLs after ADR-0005 check; tenant prefix from CLS scope (ADR-0001), never from input |
| Tenant lifecycle | Onboarding = nothing; offboarding = prefix delete + verification job |
| 10× behavior | Indifferent — GCS has no per-bucket object pressure at this scale |

- **Pros:** Matches the shared-cluster philosophy (PRD §4) and ADR-0001's enforcement pattern — the storage key builder is one audited function like the retrieval query builder (ADR-0002); zero per-tenant provisioning (PRD §5).
- **Cons:** No IAM-level tenant wall — a key-construction bug is a cross-tenant leak. Mitigated: keys are never parsed from or influenced by request input (generated UUIDs under the CLS tenant prefix), and the cross-tenant suite covers signed-URL issuance (test plan §3.1).

### Option B: Bucket per tenant

- **Pros:** IAM-level isolation; offboarding = bucket delete.
- **Cons:** 20 buckets now, 200 at 10× — quota/ops churn on tenant lifecycle (PRD §5 wants provisioning-free onboarding); per-bucket CMEK/lifecycle/monitoring fan-out; contradicts the settled per-tenant-*prefix* language (PRD §4). Rejected as operational cost without closing the actual risk (the API's single service account can read all buckets anyway).

**Decision: Option A**, plus one **separate** bucket `kms-prod-audit` with object-lock/WORM retention for the daily hash-chained audit export (sec §8.1) — platform operators cannot rewrite history, so audit isolation is physical even though data isolation is logical.

## Decision

### Buckets and layout

| Bucket | Contents | Controls |
|---|---|---|
| `kms-{env}-data` | `tenants/{tenantId}/versions/{versionId}` (originals), `…/ocr/{versionId}` (OCR text), `…/artifacts/{versionId}/{stage}` (pipeline handoffs, ADR-0003) | EU region, uniform bucket-level access, public access prevention, CMEK (ADR-0007), versioning **off** (the app owns versioning per PRD §8) |
| `kms-{env}-audit` | Daily hash-chained audit exports (ADR-0002) | Same + **object lock / retention ≥ 24 months** (PRD §12; sec §8.1) |

Object keys contain only server-generated ids; the original filename lives in `documentVersions` metadata as a display string (sec §4.4). Smart-OCR files use the same layout under the owner's records (`ocrFiles` points at the keys); isolation is repository-level (ADR-0001 `OwnerScopedRepository`), storage sees only opaque keys.

### Upload path (through the API — not direct-to-GCS)

Browser → API streaming multipart → magic-byte sniff on the first bytes + running size counter (abort > 50 MB before any GCS write beyond the resumable buffer) → stream to GCS under a generated key → enqueue `scan` (ADR-0003). Direct browser→GCS signed-PUT uploads were considered and rejected: they would store bytes **before** magic-byte/size/quota gates run (sec §4.4 ordering), and MVP volume (≤ 50 MB × modest rates, PRD §13) doesn't need the offload. Revisit only if upload throughput becomes a measured bottleneck (noted in system-overview future list).

### Download path (signed URLs)

1. Client requests download → API re-checks tenant scope (ADR-0001) + folder/owner permission (ADR-0005) **at issuance time** (sec §3.4; PRD §7 re-check semantics).
2. API issues a **V4 signed URL**: expiry **5 min**, single object, `response-content-disposition=attachment; filename*=…` (RFC 5987-encoded display name) and `response-content-type=application/octet-stream` — the file never renders inline (sec §4.4); signing identity is a dedicated service account whose key material lives in Secret Manager (ADR-0007).
3. Client fetches from GCS directly. Audit event on issuance (PRD §12 download coverage) — GCS access logs corroborate.

Signed URLs are issued per click, never stored, never embedded in listings (test plan §3.1 asserts expiry, single-object binding, and attachment disposition; iOS Safari behavior is an explicit e2e case per sec §11).

### Deletion machinery (sec §7.3: verified, not assumed)

| Trigger | Action | Verification |
|---|---|---|
| Document delete (PRD §8) | Chunks purged immediately (ADR-0002); object keys recorded on a recycle-bin entry with `purgeAfter = +30 d` (tenant-configurable) | — |
| Recycle-bin purge (auto or admin-early) | Delete all version objects + OCR outputs + metadata | **Deletion-verification job**: asserts 0 chunks, 0 Atlas Search hits, 404 on every recorded object key; writes verification record + audit event |
| Smart-OCR 7-day expiry (PRD §15) | Mongo TTL on `ocrFiles.expiresAt` drives a purge worker (delete objects + record) — TTL alone is not trusted (ADR-0002) | Same verification job, per file; metering rows untouched (PRD §15) |
| Tenant offboarding (PRD §14) | Export (files + metadata + audit, open formats) → prefix-wide delete → **deletion certificate generated from the verification job's output** | Prefix listing must be empty; certificate lists verified counts |
| Backup ageing | Atlas/GCS backups expire within the stated retention window (sec §7.3) | Quarterly restore drill confirms both restore *and* expiry (test plan §8.3) |

A **lifecycle backstop** on `kms-{env}-data`: delete `tenants/*/artifacts/*` after 7 days (pipeline handoffs are transient, ADR-0003) — belt-and-suspenders, the index stage already deletes them.

### Data Flow (download round-trip)

| Role | Actor | Channel |
|------|-------|---------|
| Initiator | Browser (B3/D1 download action) | HTTPS → API |
| Processor | API: ADR-0001 scope + ADR-0005 permission → sign V4 URL (5 min) | In-process + Secret Manager-held key |
| Return path | 302/JSON with signed URL → browser fetches from GCS | HTTPS to storage domain |
| Error path | Permission miss ⇒ 404 (sec §3.2); expired URL ⇒ GCS 403 (user retries via app) | — |

## Consequences

- **Positive:** One key-builder function + signed-URL issuance point concentrates the entire storage attack surface into two audited code paths (CODEOWNERS, sec §10); deletion produces evidence, satisfying PRD §14's certificate and the 2017-regs posture; the WORM audit bucket closes the "platform admin rewrites history" threat (sec §0 insider row).
- **Negative / accepted risks:** Logical (not IAM) tenant isolation in storage — accepted with the same layered-guard rationale as ADR-0001, and it is exactly what PRD §4 specifies; API-streamed uploads put upload bandwidth on the API service — fine at MVP, revisit threshold noted; 5-min URLs on slow mobile links could expire mid-download for 50 MB files — accepted (URL validity gates *start*, not completion; GCS honors in-flight transfers).
- **Follow-ups:** ADR-0007: CMEK keys, service accounts (least privilege: API sign-only vs worker read-write), bucket Terraform; test plan §3.1 signed-URL assertions and §3.6 deletion verification; offboarding runbook (process doc, implementation phase).
