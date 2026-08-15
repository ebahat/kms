# ADR-0014: Hosting Topology on OCI (supersedes ADR-0007, rebinds ADR-0006)

**Status:** Accepted (2026-08-15)
**Date:** 2026-08-15
**Deciders:** Product owner (Ehud)
**Sources:** ADR-0007 (superseded), ADR-0006 (rebound, not superseded — its logical decisions stand),
`docs/deployment/oci-vs-gcp-cost-comparison-15-08-2026-research.md`, PRD §3, §5, §13; sec §4.4, §6,
§7.4, §8.3

## Status

Accepted. Supersedes ADR-0007 in full — GCP is no longer the production hosting target. Rebinds
ADR-0006's cloud-specific primitives (GCS, Cloud KMS, Secret Manager) to OCI equivalents; ADR-0006's
logical decisions (bucket-per-env + tenant-prefix layout, WORM audit bucket, signed-URL semantics,
upload-through-the-API path, deletion-verification machinery) are **not** reopened — see "What
ADR-0006 keeps" below. `infra/`'s existing Terraform (GCP-shaped) has never been applied — nothing is
migrating, this is a from-scratch build on the new target.

## Context

ADR-0007 was accepted 2026-07-10 on a "lean GCP" directional call made during initial planning, before
any infrastructure existed. As of this ADR, `infra/` still has never been `terraform apply`'d — no
real cost or migration exists to reverse, only a decision to make before the first real deploy. Given
that, the deciding factor became **cost structure at production volume**, not sunk cost:

- This system provisions **two** Redis instances (`redis-app`, `redis-queue` — ADR-0007's own design
  review finding 1, opposite eviction policies). On GCP Memorystore Basic tier that's ≈$72/mo minimum
  before HA; OCI Cache with Redis is roughly a third of that at the same footprint.
- The core file-serving primitive (ADR-0006: short-lived signed URLs for document downloads) is
  genuinely egress-heavy. GCP Premium-tier egress ($0.12/GB) is ~14x OCI's post-free-tier rate
  ($0.0085/GB after 10 TB/month free) — a material, recurring cost delta at any real tenant volume, not
  just a free-tier MVP optimization.
- Compute is the one dimension where GCP's Cloud Run (scale-to-zero, pay-per-request) can beat an
  always-on OCI instance under low/bursty traffic — but Phase 3's ingestion workers (BullMQ consumers,
  currently deferred, see `docs/plans/implementation-phases-11-07-2026-plan.md`) need to poll
  continuously once built, which doesn't scale-to-zero well on either platform. That future workload
  neutralizes Cloud Run's main structural advantage.

Full pricing sources and reasoning: `docs/deployment/oci-vs-gcp-cost-comparison-15-08-2026-research.md`.

**What does NOT change:** MongoDB Atlas (a separate managed service, unaffected by which cloud hosts
compute), the application layer (no GCP-specific code exists outside the two interfaces below), and
v1.0's scope (file hierarchy only — auth + folders/permissions/groups/upload/download; Phase 3
ingestion/OCR and Phase 4 chat/Vertex AI remain deferred and unbuilt regardless of hosting).

**Open question flagged, not resolved here:** ADR-0007's 2026-08-02 revisit rejected `me-west1` for
GCP specifically because Vertex AI's EU-residency guarantee doesn't cover Middle East regions. Vertex
AI (ADR-0008) is still the planned LLM/embedding provider and is entirely unimplemented
(`libs/ai-providers` is an empty package) — nothing about *this* ADR changes that plan. Calling Vertex
AI's API from OCI-hosted compute is a normal external HTTPS call and shouldn't affect Google's own
regional-processing guarantee, but this hasn't been verified against Vertex AI's actual terms for a
non-GCP caller. **Revisit before Phase 4 is built**, not before this hosting decision — there is no
Vertex AI traffic today to be affected.

## Options Considered

### Option A: OCI, Compute instances + Container Instances hybrid (chosen)

Ampere A1 (ARM) Compute instances for the always-on pieces (api, portal-api, redis-adjacent workloads
once they exist), Container Instances for anything genuinely bursty/per-request-shaped.

| Dimension | Assessment |
|---|---|
| Complexity | Low-medium — no cluster to operate, same "deploy = image + service definition" shape as Cloud Run, but less mature tooling |
| Cost | Redis and egress meaningfully cheaper than GCP at real volume (see Context); Always Free Ampere allocation (2 OCPU/12 GB as of June 2026) covers early-stage compute entirely |
| Sandbox fit | VCN + per-pool subnets + Network Security Groups — same conceptual shape as ADR-0007's per-pool subnet/firewall posture, different primitive names |
| Ops burden | Higher than Cloud Run today — smaller ecosystem, fewer Terraform examples, more DIY orchestration around always-on instances vs. Cloud Run's pure serverless model |

- **Pros:** Meaningfully cheaper at this app's actual usage shape (two Redis instances, egress-heavy
  file serving); OCI Always Free tier absorbs early-stage compute/storage cost entirely; EU regions
  exist (Frankfurt, Amsterdam) so residency posture (PRD §3) is preservable.
- **Cons:** Less mature IaC/tooling ecosystem than GCP; `infra/`'s Terraform must be rewritten from
  scratch (nothing carries over 1:1); team has zero prior OCI operational experience, unlike the "lean
  GCP" directional familiarity ADR-0007 was originally anchored to.

### Option B: Stay on GCP (status quo, i.e. do not accept this ADR)

- **Pros:** Zero rework — `infra/`'s Terraform already exists and matches ADR-0007; Cloud Run's
  scale-to-zero is genuinely better for low/bursty early-stage traffic; more mature ecosystem.
- **Cons:** Structurally more expensive at this app's specific heavy-Redis, egress-heavy shape once
  real usage exists — the cost gap isn't a free-tier artifact, it persists at volume (see Context).
  Rejected because nothing is deployed yet — this is the cheapest possible moment to make this call,
  and the cost case is real, not speculative.

**Decision: Option A.** Same "drop-in equivalents if the cloud decision ever reopens" reasoning ADR-0007
itself flagged as an accepted risk under "Vendor coupling" — that door was deliberately left open, and
this ADR walks through it before any real coupling exists.

## Decision

### Topology (mirrors ADR-0007's shape, OCI primitives)

| Component | ADR-0007 (GCP) | This ADR (OCI) | Placement / posture |
|---|---|---|---|
| Web (Next.js) | Cloud Run `web` | Compute instance or Container Instance `web` | Public via LB |
| API (NestJS) | Cloud Run `api` | Compute instance `api` (Always Free Ampere-eligible) | Public via LB; VCN egress: Atlas, OCI Cache, Object Storage, (future) Vertex AI, email API |
| Admin portal | Cloud Run `portal-api` | Compute instance `portal-api` | Public via LB on `admin.…` hostname, separate posture (ADR-0004 realm unchanged) |
| Parse pool | Cloud Run `worker-parse` (gVisor) | Container Instance `worker-parse` | Subnet `subnet-parse`; NSG egress: in-VPC clamd + Object Storage + OCI Cache + Atlas **only** — no internet (sec §4.4), unchanged posture, not yet built (Phase 3 deferred) |
| Malware scan | Cloud Run `clamd` | Container Instance `clamd` | In `subnet-parse`; same ClamAV design (ADR-0003), not yet built |
| OCR/Embed pool | Cloud Run `worker-ai` | Container Instance `worker-ai` | Subnet `subnet-ai`; not yet built (Phase 3/4 deferred) |
| Index pool | Cloud Run `worker-index` | Container Instance `worker-index` | Subnet `subnet-index`; not yet built |
| Redis — app | Memorystore `redis-app` (Standard/HA) | OCI Cache with Redis `redis-app` | Private, AUTH + TLS; same eviction posture (`volatile-lru`, ADR-0004/0005 caches — re-derivable) |
| Redis — queue | Memorystore `redis-queue` (Standard/HA) | OCI Cache with Redis `redis-queue` | Private, AUTH + TLS; `noeviction`, sized headroom — unchanged rationale (ADR-0003, not yet built) |
| MongoDB Atlas | Private Service Connect (GCP) | Standard Atlas connection string (no OCI PrivateLink equivalent needed for this scale) — **unchanged decision**, ADR-0002 stands | EU region, AES-256 Atlas-managed KMS |
| Object storage | GCS (ADR-0006) | OCI Object Storage — same bucket-per-env + tenant-prefix layout, same WORM/retention on the audit bucket | EU region (Frankfurt/Amsterdam) |
| Edge | Global external ALB + Cloud Armor | OCI Flexible Load Balancer + OCI WAF | Managed TLS, rate-based bans on auth endpoints — unchanged requirement (sec §6) |
| Secrets | Secret Manager | OCI Vault (secrets) | Per-env, accessed via instance principal, never baked into images |
| Field-level crypto | Cloud KMS | OCI Vault (KMS) | Envelope keys for TOTP secrets/backup codes (sec §7.2) — requires a new `OciKeyProvider` implementing `KmsKeyProvider` (`libs/auth/src/kms-envelope.ts`); `LocalMasterKeyProvider` remains the binding until this is built |

### What ADR-0006 keeps vs. what rebinds

**Keeps (logical decisions, unchanged):** bucket-per-environment + per-tenant key-prefix layout;
separate WORM/retention-locked audit bucket; upload streamed through the API (never direct-to-storage)
with magic-byte + 50 MB gate before any write; download exclusively via short-lived (5 min) signed
URLs issued after a fresh permission re-check, `attachment`-forcing disposition, RFC 5987 filename
encoding; the deletion-verification machinery (recycle-bin purge, Smart-OCR TTL purge, tenant
offboarding certificate) and its "verified, not assumed" discipline.

**Rebinds (primitive only):** GCS → OCI Object Storage; V4 signed URLs → OCI pre-authenticated
requests (PARs) — same semantics (single object, time-limited, attachment-forcing), different API
shape, requires a new `OciStorageProvider` implementing the existing `StorageProvider` interface
(`apps/api/src/documents/storage/storage-provider.ts`); Cloud KMS-backed CMEK → OCI Vault-backed
encryption at rest (OCI Object Storage supports customer-managed keys via Vault natively); Secret
Manager → OCI Vault secrets.

**Required code, not yet written:** `OciStorageProvider` (two implementation paths documented in
`docs/deployment/gcp-aws-deployment-guide-11-08-2026.md`'s OCI section — native `oci-sdk` or the
S3-compatible endpoint fast path) and, later, `OciKeyProvider` for `KmsKeyProvider`. Both interfaces
already exist and are already the production seam — this is additive, not a rewrite of `apps/api`.

### IaC, delivery, observability

- **Terraform** for everything above, in-repo, replacing `infra/`'s GCP modules (network, redis,
  storage, secrets, compute) with OCI-provider equivalents — same "IaC reviewed like code" discipline
  (sec §6), same repo location and PR-review posture as ADR-0009 established. Tracked as its own
  implementation plan, not written inline in this ADR (Rule 2: plans before implementation).
- CI/CD: GitHub Actions OIDC → OCI identity federation (or a scoped API signing key as an interim
  secret) replaces Workload Identity Federation. Same "no long-lived exported credentials" intent as
  ADR-0007, exact mechanism TBD in the implementation plan.
- Observability: OCI Monitoring + Logging replace Cloud Monitoring; same alert-class catalogue (sec
  §8.3) — the catalogue is platform-agnostic, only the delivery mechanism changes.

### Backup / DR (unchanged targets: PRD §13, RPO ≤ 24 h, RTO ≤ 8 h)

- **Atlas:** unchanged — continuous cloud backup is a Atlas-managed capability, independent of hosting
  cloud.
- **OCI Object Storage:** same role as GCS held — system of record for files, deletion-verification
  design (ADR-0006) unchanged; OCI Object Storage supports versioning and lifecycle policies
  equivalent to GCS's.
- **Redis:** unchanged reasoning — both instances are ephemeral by design, no backup dependency.
- **RTO path:** same shape — region-internal HA for zone loss; full-region loss = restore Atlas
  snapshot + `terraform apply` to a sibling EU OCI region. Not yet drilled (nothing is deployed).

## Consequences

- **Positive:** Redis and egress — this app's two heaviest real cost centers given its actual shape
  (two Redis instances, signed-URL-heavy file serving) — get meaningfully cheaper at production volume,
  not just during a free-tier MVP window; OCI's Always Free tier absorbs early-stage compute/storage
  cost entirely; made before any real deploy exists, so there is zero migration cost, only a decision
  cost.
- **Negative / accepted risks:** Less mature IaC ecosystem and zero prior team operational experience
  with OCI, accepted as a one-time learning cost against a recurring savings; Oracle's Always Free
  allocation has already been cut once (Ampere halved June 2026) — anything long-term-load-bearing
  should be sized against paid rates, not the free allowance; the Vertex AI / non-GCP-caller
  data-residency question (Context, above) is explicitly unresolved and must be revisited before Phase
  4 (chat) is built, not blocking this hosting decision since no Vertex traffic exists yet.
- **Follow-ups:** Implementation plan for the OCI Terraform modules + `OciStorageProvider` (tracked
  separately per Rule 2, plan-before-implementation); `OciKeyProvider` remains a Follow-up, not blocking
  (mirrors ADR-0007's own KMS Follow-up pattern — `LocalMasterKeyProvider` is a legitimate interim
  binding); revisit the Vertex AI residency question before ADR-0008's implementation phase begins;
  `docs/architecture/system-overview.md`'s ADR index and container diagram need updating to reference
  this ADR in place of ADR-0007.