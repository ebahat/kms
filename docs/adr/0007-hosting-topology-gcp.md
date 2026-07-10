# ADR-0007: Hosting Topology on GCP (europe-west)

**Status:** Accepted (2026-07-10)
**Date:** 2026-07-10
**Deciders:** Product owner (Ehud); drafted in the architecture/ADR pass
**Sources:** PRD §3, §5, §13; sec §4.4, §6, §7.4, §8.3; ADR-0003 (worker pools), ADR-0004 (Redis sessions), ADR-0006 (buckets); plan interview (lean GCP, europe-west)

## Status

Accepted 2026-07-10 — step-6 consistency review passed; review fixes applied (findings record in the plan). Cloud = GCP and region = europe-west are directional decisions from the planning interview (Google Vision is already a Classic-OCR candidate, PRD §2/§16); this ADR fixes the topology within them.

## Context

The workload is: one API service, one admin-portal API (ADR-0004; its UI is served by the web app — see topology), one Next.js web frontend, three worker pools with **mutually exclusive egress postures** (ADR-0003: parse = no internet, ocr/embed = named AI endpoints only, index = Atlas only), two Redis instances (app: sessions ADR-0004; queue: BullMQ ADR-0003 — split per the 2026-07-10 design review), MongoDB Atlas, two GCS buckets (ADR-0006). Constraints:

- EU residency for all tenant data including backups (PRD §3); zero-retention sub-processors (sec §9).
- Atlas via private endpoint, Redis private + AUTH/TLS, egress restricted to named APIs, WAF + DDoS at the edge, secrets in a manager, CMEK/AES-256 at rest, TLS 1.3, least-privilege per-component service accounts, minimal non-root images, IaC reviewed like code (sec §6).
- Availability 99.5%, RPO ≤ 24 h, RTO ≤ 8 h (PRD §13); queue-depth/error-rate/provider-status feeding platform health (PRD §5); sec §8.3 alert classes.
- MVP scale is small (20 tenants / 8k users) but the sandbox boundary must be real, not aspirational (sec §4.4). Team is small — ops burden is a first-class dimension.

## Options Considered

### Option A: Cloud Run for everything (chosen)

All six services (api, portal-api, web, worker-parse, worker-ai, worker-index) as Cloud Run services with Direct VPC egress into per-pool subnets; BullMQ workers run with `min-instances ≥ 1` and CPU always-allocated (long-lived Redis connections).

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — no cluster to operate; deploy = image + service YAML |
| Sandbox fit | Good — per-service subnet + firewall egress rules; first-gen execution environment (gVisor) for the parse pool adds syscall filtering (sec §4.4) |
| Cost | Scale-to-near-zero off-hours; ~6 × min-instance baseline |
| Scaling | Per-service concurrency knobs map 1:1 to ADR-0003 per-queue tuning |
| Ops burden | Minimal — no node upgrades, no control plane |

- **Pros:** Matches "lean GCP" and team size; per-pool network posture is expressible (VPC egress → subnet → firewall allowlist per pool); managed autoscaling covers 10× without redesign (PRD §13).
- **Cons:** Egress filtering is subnet/firewall-based, not per-process; no Kubernetes NetworkPolicy granularity; long-running jobs capped (Cloud Run request/instance lifetimes) — fine for ADR-0003's stage timeouts (≤ 15 min OCR) but worth watching.

### Option B: GKE Autopilot

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium-high — cluster lifecycle, workload manifests, upgrade cadence |
| Sandbox fit | Best — NetworkPolicy per pod, gVisor (`gke-sandbox`) selectable per workload |
| Cost | Autopilot per-pod pricing; no idle-node waste but higher floor than Cloud Run at this scale |
| Ops burden | Real — even Autopilot needs version/PDB/policy attention |

- **Pros:** Finest-grained network control; no execution-time ceilings; portable manifests.
- **Cons:** Buys control the MVP doesn't need at the cost of permanent ops attention; the sec §4.4/§6 requirements are satisfiable with Option A's subnet-level controls. Over-provisioned for 20 tenants (PRD §13) — same over-engineering logic that rejected Temporal in ADR-0003.

**Decision: Option A**, with GKE as the documented escalation path if a future workload needs NetworkPolicy-grade egress control or >60-min jobs.

## Decision

### Topology (one GCP project per environment: `kms-prod`, `kms-staging` — sec §10 full separation)

| Component | Service | Placement / posture |
|---|---|---|
| Web (Next.js) | Cloud Run `web` | Public via LB; serves UI only — all data via API |
| API (NestJS) | Cloud Run `api` | Public via LB; VPC egress: Atlas PSC, Memorystore, GCS, Vertex AI, email API |
| Admin portal | Cloud Run `portal-api` (ADR-0009 naming); admin UI served by `web` on the `admin.…` hostname | Public via LB on separate hostname (`admin.…`), separate service account (ADR-0004 realm); optional Cloud Armor IP allowlist (sec §2). No separate frontend app — the realm boundary is API + user store + cookie + hostname, and all data flows via APIs (design review 2026-07-10, finding 8) |
| Parse pool | Cloud Run `worker-parse`, **gen1 (gVisor)** | Subnet `snet-parse`; firewall egress: in-VPC `clamd` + GCS + Memorystore + Atlas PSC **only** — no internet (sec §4.4); the test-plan §3.3 canary-egress probe runs against this rule |
| Malware scan | Cloud Run `clamd` (internal ingress only) | In `snet-parse`; ClamAV daemon (ADR-0003 decision); its **only** external egress: ClamAV signature mirror for `freshclam`; stale-signature alert (sec §8.3) |
| OCR/Embed pool | Cloud Run `worker-ai` | Subnet `snet-ai`; egress: Vertex AI, Google Vision/Azure OCR endpoints, GCS, Memorystore, Atlas PSC (sec §5.6, §6) |
| Index pool | Cloud Run `worker-index` | Subnet `snet-index`; egress: Atlas PSC + GCS + Memorystore only |
| Redis — app | Memorystore `redis-app`, **Standard (HA)** tier | Private, AUTH + in-transit TLS (sec §6); sessions (ADR-0004), login/lockout counters, permission cache (ADR-0005), rate limits — all re-derivable or re-login-able, so eviction under pressure is tolerable (`volatile-lru`) |
| Redis — queue | Memorystore `redis-queue`, **Standard (HA)** tier | Private, AUTH + TLS; BullMQ only (ADR-0003); **`noeviction`** + sized headroom + used-memory alert (sec §8.3) — BullMQ corrupts/loses jobs under any eviction policy. Two instances because the workloads need *opposite* eviction policies and an ingestion burst must never evict sessions (design review 2026-07-10, finding 1) |
| MongoDB Atlas | M10+ (EU, `europe-west`) | **Private Service Connect** — no public endpoint (sec §6); AES-256 at rest (Atlas-managed KMS) |
| Object storage | GCS per ADR-0006 | CMEK via Cloud KMS; EU region |
| Edge | Global external ALB + **Cloud Armor** | WAF preconfigured rules (OWASP CRS), rate-based bans on auth endpoints (sec §6 bot management), managed TLS certs (1.3) |
| Secrets | Secret Manager | Pepper (ADR-0004), provider API keys, signing SA key (ADR-0006); per-env; accessed via service identity, never baked into images (sec §6) |
| Field-level crypto | Cloud KMS | Envelope keys for TOTP secrets/backup codes (sec §7.2); annual rotation (sec §6) |

### Identity & access

One service account per Cloud Run service, scoped to exactly its resources (sec §6): e.g., `sa-api` = Secret Manager (its secrets) + GCS sign/read-write on `tenants/*` + Vertex invoke; `sa-worker-parse` gets **no** Vertex access; `sa-portal` cannot touch data buckets. Humans: no standing production access; Google Workspace SSO + MFA, just-in-time elevation via short-lived grants, all audited (sec §6, §7.5). CI deploys via **Workload Identity Federation** from the repo's CI — no exported service-account keys (sec §6 "no secrets in git" posture).

### IaC, delivery, observability

- **Terraform** for everything above, in-repo (`infra/`, ADR-0009), PR-reviewed like code + `snyk_iac_scan` gate (sec §6; audit plan §2).
- Deploys: CI builds minimal non-root images (distroless base), scans (audit plan §2), deploys staging → prod with Cloud Run revision rollback as the escape hatch.
- Observability: Cloud Monitoring dashboards per PRD §5 (queue depth/age via BullMQ metrics pushed from workers, error rates, provider latency); alerting policies implement the sec §8.3 catalogue (failed-login bursts, cross-tenant 404 spikes, mass downloads, malware detections, spend anomalies, poison files) routed to on-call; logs structured, content-free per sec §8.2.

### Backup / DR (PRD §13: RPO ≤ 24 h, RTO ≤ 8 h)

- **Atlas:** continuous cloud backup, EU-region snapshot storage, daily snapshot retention ≥ 7 d — RPO in minutes, well inside 24 h.
- **GCS:** data bucket is the system of record for files; cross-checked by the deletion-verification design (ADR-0006). Daily bucket inventory + soft-delete window (7 d) covers accidental-deletion recovery inside RPO.
- **Redis:** ephemeral by design — `redis-app` losses mean re-login (ADR-0004); `redis-queue` jobs are re-enqueueable from `documents.status` (ADR-0003 idempotency); no backup dependency on either instance.
- **RTO path:** region-internal (multi-zone) HA covers zone loss; full-region loss = restore Atlas snapshot + `terraform apply` to a sibling EU region + GCS dual-region consideration deferred (accepted risk at 99.5%/MVP — a full region outage burning the 8 h RTO is within the availability budget). Quarterly restore drill asserts the numbers (test plan §8.3; sec §7.4).

### Data Flow (deploy + alert paths are the async boundaries here)

| Role | Actor | Channel |
|------|-------|---------|
| Initiator | CI on merge to main | Workload Identity Federation → Cloud Run deploy |
| Processor | Cloud Run revision rollout (staging first) | gcloud/Terraform |
| Return path | Health checks gate traffic shift; failed revision auto-rolls back | LB health checks |
| Error path | Alert policies (sec §8.3) → on-call | Cloud Monitoring → paging channel |

## Consequences

- **Positive:** Zero cluster operations for a solo/small team; the ADR-0003 sandbox boundary is enforced by network *configuration* (subnets/firewall/service accounts) that Terraform makes reviewable and the canary probe makes testable; per-service autoscaling absorbs 10× (PRD §13) without topology change.
- **Negative / accepted risks:** Subnet-level (not per-process) egress control — accepted; the parse pool's gVisor gen1 environment plus no-egress firewall is defense in depth matching sec §4.4's intent. Single-region DR posture accepted at 99.5% (documented above). Cloud Run cold starts are mitigated by min-instances but add a small fixed cost. Vendor coupling (Memorystore/Cloud Armor/Secret Manager) accepted per the "lean GCP" direction — all components have drop-in equivalents if the cloud decision ever reopens.
- **Follow-ups:** Terraform module skeleton is an implementation-phase first task (with `snyk_iac_scan` wired, audit plan §2); egress canary probe in CI against staging (test plan §3.3); Cloud Armor rule tuning after first traffic; ADR-0008 pins the exact Vertex endpoints for the `snet-ai` firewall allowlist.
