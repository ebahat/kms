# OCI vs. GCP — cost and architecture considerations

Status: research note, not a decision. ADR-0007 (Accepted) chose GCP for the production system;
nothing here supersedes that on its own. This exists to capture the reasoning discussed 2026-08-15
when evaluating Oracle Cloud's free tier as a possible alternative, before any commitment is made.
If OCI is later adopted as the real target, write a superseding ADR referencing this note — don't
treat this doc itself as the decision record.

## Why this came up

Oracle Cloud's free tier is unusually generous compared to GCP's, and — more importantly for this
app's specific shape — OCI's *paid* rates for the two services this system leans on hardest (Redis,
egress) are also meaningfully cheaper than GCP's, not just free-tier-cheaper. That combination is
what makes this worth a real look rather than a pure cost-avoidance move for an MVP.

## What's cloud-agnostic already (low friction to move)

- **MongoDB Atlas** — a separate managed service with its own pricing, unaffected by which cloud
  hosts compute. No change needed either way.
- **`StorageProvider`** (ADR-0006, `apps/api/src/documents/storage/storage-provider.ts`) — already a
  4-method interface. Needs a new `OciStorageProvider` implementation; see
  `docs/deployment/gcp-aws-deployment-guide-11-08-2026.md`'s OCI section for the two implementation
  options (native SDK vs. OCI's S3-compatible endpoint).
- **`KmsKeyProvider`** (envelope encryption, `libs/auth/src/kms-envelope.ts`) — same pattern; only
  `LocalMasterKeyProvider` exists today regardless of cloud, so this isn't a GCP-specific gap to begin
  with.
- **Vertex AI (ADR-0008)** — the ADR already documents a Vertex→Cohere→OpenAI fallback if the Hebrew
  benchmark fails, so the LLM/embedding layer was never hard-locked to GCP. Those are external API
  calls reachable from any cloud.
- **Redis, the NestJS apps themselves** — no GCP-specific code; `ioredis` and standard Node runtimes
  work anywhere.

## What's genuinely GCP-shaped (real rework required)

- **`infra/`'s entire Terraform layer** (ADR-0007: 6 Cloud Run services, VPC connectors, per-worker-pool
  subnet egress rules) — needs an OCI-equivalent (Compute/Container Instances instead of Cloud Run,
  VCN instead of VPC), not a config swap.
- **Signed-URL mechanics** — GCS V4 signing vs. OCI's pre-authenticated requests (PARs) are different
  APIs behind the same interface.
- **ADR-0006 and ADR-0007 are formally Accepted** — reversing them needs a superseding ADR, per this
  project's own process discipline.

## Pricing comparison (as researched 2026-08-15)

| | GCP | OCI |
|---|---|---|
| **Compute** | Cloud Run: pay-per-request/vCPU-time, scales to zero. Free tier: 2M requests, 180K vCPU-s, 360K GiB-s/mo | x86 Flex: $0.0255/OCPU-hr; ARM Ampere: $0.01/OCPU-hr. Always Free: 2 OCPU / 12 GB ARM (halved from 4/24 in June 2026 — treat as a discount, not a permanent allocation) |
| **Object storage** | GCS Standard: $0.020/GB-month | OCI Standard: ~$0.0255/GB-month, but 20 GB Always Free |
| **Managed Redis** | Memorystore Basic 1 GiB ≈ $36/mo; 10 GiB Standard (HA) ≈ $394/mo | OCI Cache: $0.0194/GB-hr (first 10 GB/node) → 1 GiB ≈ $14/mo |
| **Egress** | Premium tier $0.12/GB (1 GiB free/mo, 200 GiB on Standard tier) | $0.0085/GB after **10 TB free every month** |

## Why this specific app's shape favors OCI on cost

- **Redis**: the existing Terraform provisions *two* instances (`redis-app`, `redis-queue`). GCP Basic
  tier ≈ $72/mo minimum for that footprint before any HA; OCI Cache is roughly a third of that.
- **Egress**: the app's core file-serving primitive is short-lived signed URLs for document downloads
  (ADR-0006) — a genuinely egress-heavy pattern. GCP Premium-tier egress is ~14x OCI's post-free-tier
  rate, and OCI's 10 TB/month free allowance likely covers an early-stage tenant base outright.
- **Compute** is the one place GCP can win, situationally — Cloud Run's scale-to-zero billing beats an
  always-on OCI VM under low/bursty traffic. But Phase 3's ingestion workers (BullMQ consumers,
  currently deferred — see `docs/plans/implementation-phases-11-07-2026-plan.md`) need to poll
  continuously once built, which doesn't scale-to-zero well on either platform — that future workload
  favors OCI's flatter per-OCPU pricing once it exists.
- Object storage itself is a close wash ($0.020 vs. $0.0255/GB), irrelevant next to the egress delta
  for this app's usage pattern.

## Non-cost tradeoffs

- **Tooling/ecosystem maturity**: GCP's Terraform provider and Cloud Run are more battle-tested for
  this "many small NestJS services" shape. OCI's equivalents (Compute/Container Instances, VCN, OKE)
  mean more DIY orchestration and fewer community examples to lean on.
- **Free-tier durability**: Oracle already cut the flagship Ampere allocation once (June 2026). Size
  anything long-term-load-bearing on the paid rates, not the free allowance.

## Bottom line

For a project whose two heaviest cost centers are Redis and file-serving egress, OCI looks cheaper at
real production volume, not just during free-tier MVP stage — this is a genuine cost case, not only an
MVP-cost-avoidance move. The friction is entirely in the infra-layer rewrite (`infra/`'s Terraform) and
formally superseding ADR-0006/0007 if this becomes the real target.

## Sources

- [Oracle Cloud Free Tier 2026 changes](https://terminalbytes.com/oracle-cloud-free-tier-changes-2026/)
- [Oracle Cloud Free Tier | Oracle](https://www.oracle.com/cloud/free/)
- [Cloud Egress Pricing Comparison 2026](https://egresscost.com/compare/)
- [OCI Costs Overview & Comparison](https://www.finout.io/blog/oci-costs-overview)
- [Google Cloud Run Pricing 2026](https://cloudpricecheck.com/gcp/cloud-run-pricing)
- [Google Memorystore Redis Pricing](https://www.dragonflydb.io/guides/google-cloud-redis-pricing)
- [Google Cloud Storage Pricing 2026](https://www.cloudzero.com/blog/gcp-storage-pricing/)
- [OCI Compute Pricing 2026](https://oraclelicensingexperts.com/blog/oracle-oci-compute-pricing/)
- [OCI Cache with Redis Pricing](https://www.oracle.com/ie/cloud/redis/pricing/)
- [OCI Object Storage Pricing 2026](https://oraclelicensingexperts.com/blog/oracle-oci-storage-pricing/)
