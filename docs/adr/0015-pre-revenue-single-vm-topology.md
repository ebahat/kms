# ADR-0015: Pre-Revenue Single-VM Topology (OCI Always Free)

**Status:** Accepted (2026-08-16)
**Date:** 2026-08-16
**Deciders:** Product owner (Ehud)
**Sources:** [ADR-0014](0014-hosting-topology-oci.md) (retargeted, not superseded), ADR-0006 (storage/serving),
ADR-0003 (worker pools — deferred), PRD §3 (EU residency), §13 (availability targets),
`docs/deployment/oci-vs-gcp-cost-comparison-15-08-2026-research.md`,
[Oracle Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

## Status

Accepted 2026-08-16 (owner approved after review). **Does not supersede ADR-0014** — it retargets it. ADR-0014 stays the documented
*scale-up* topology (managed Container Instances / OCI Cache / LB+WAF) for when there are paying
customers and managed-HA is worth paying for. This ADR is the *starting* topology for a pre-revenue
system with zero users.

## Context

ADR-0014 chose OCI over GCP, substantially on cost. Its Terraform was written, verified against a
real tenancy (`terraform plan`: 52 resources, 0 errors), and merged — but never applied.

**A pre-apply cost review (2026-08-16) found ADR-0014's own free-tier claim to be wrong.** It stated
"OCI's Always Free tier absorbs early-stage compute/storage cost entirely." Checked against Oracle's
authoritative Always Free list, three of its core building blocks are **not Always Free at all**:

| ADR-0014 resource | Always Free? | Est. cost |
|---|---|---|
| Container Instances × 7 (`CI.Standard.E4.Flex`, 7 OCPU / 26 GB total) | **No** — not on the list | ~$156/mo |
| OCI Cache with Redis × 2 (2 GB + 4 GB) | **No** — not on the list | ~$85/mo |
| WAF (policy + firewall) | **No** — not on the list | metered |
| Flexible Load Balancer | Yes, but **only** at 10 Mbps min *and* max; ADR-0014 set max=100 | — |

≈ **$240+/month to run zero users**, against `:bootstrap` placeholder images that don't exist in OCIR
yet. The comparative case for OCI over GCP still holds (Redis and egress genuinely are cheaper) — the
free-tier claim specifically was false, and is corrected in ADR-0014's own Status section.

Compounding it: **4 of those 7 container instances (`worker-parse`, `worker-ai`, `worker-index`,
`clamd`) exist solely to serve Phase 3 (ingestion/OCR)** — explicitly descoped from v1.0 on
2026-08-15. ADR-0014 provisioned infrastructure for phases this project decided not to build yet.

Constraints this ADR must fit:
- **v1.0 scope is the file hierarchy alone** — auth + folders/permissions/groups/upload/download.
  No document processing (Phase 3 deferred), no chat/RAG (Phase 4 deferred), no calendar UI (v1.1).
- EU residency for tenant data (PRD §3) — unchanged.
- Zero users, zero revenue. Availability targets (PRD §13: 99.5%, RPO ≤ 24 h, RTO ≤ 8 h) are
  **launch** targets, not pre-launch ones.
- Oracle has already halved the Always Free Ampere allocation once (June 2026, 4 OCPU/24 GB →
  2 OCPU/12 GB). Anything built on the free tier must be portable off it cheaply.

## Options Considered

### Option A: Apply ADR-0014 as-is

- **Pros:** Already written, validated, and merged; managed services mean no self-hosted ops.
- **Cons:** ~$240/mo for zero users; provisions deferred-phase infrastructure; managed HA buys
  nothing when there is no traffic to be available for. Rejected as paying launch-grade prices at
  pre-launch stage.

### Option B: Trim ADR-0014's managed topology to fit the free tier

Drop the 4 deferred-phase container instances, shrink the rest.

- **Pros:** Smallest diff from what exists.
- **Cons:** Doesn't work — Container Instances, OCI Cache, and WAF are *categorically* not Always
  Free, at any size. There is no "smaller" that reaches $0. Rejected as impossible, not merely
  suboptimal.

### Option C: Single VM running docker-compose, Caddy at the edge (chosen)

One Always Free Ampere A1 VM (2 OCPU / 12 GB) running the whole v1.0 stack as containers, with Caddy
terminating TLS and routing by hostname. Redis self-hosted as two containers. Object Storage, Vault,
and networking stay as OCI managed services (all Always Free). MongoDB Atlas M0 stays external.

- **Pros:** $0/month. Fits v1.0 with ~8 GB headroom. **Portable** — the same `docker-compose.yml`
  runs on Hetzner (~€13/mo) or any VPS, so the free tier is no longer load-bearing for the
  architecture. Two genuine capability *gains* over ADR-0014 (below).
- **Cons:** No managed HA/failover; single point of failure; backups become DIY; self-hosted Redis is
  ops surface ADR-0014 didn't have. All accepted at pre-revenue stage, all reversible by applying
  ADR-0014 later.

**Decision: Option C.**

### Two things Option C does *better*, not just cheaper

1. **Real hostname routing.** ADR-0014's LB does per-port listeners (`:8080`/`:8081`/`:8090`) — a
   known, flagged gap, because host-header routing needs OCI LB Routing Policies that were never
   implemented. Caddy does `api.<domain>` / `admin.<domain>` / `app.<domain>` natively, with automatic
   Let's Encrypt TLS. This restores ADR-0004's admin-realm hostname separation, which ADR-0014
   silently could not deliver.
2. **The Redis eviction-policy split actually works.** ADR-0007's design review (finding 1) requires
   `redis-app` = `volatile-lru` and `redis-queue` = `noeviction`. ADR-0014's cache module could not
   configure this — flagged `UNVERIFIED`, both clusters left on OCI Cache defaults. Two Redis
   containers with explicit `--maxmemory-policy` flags implement it exactly as specified.

## Decision

### Topology

| Component | Resource | Always Free? |
|---|---|---|
| Compute | 1 × `VM.Standard.A1.Flex`, **2 OCPU / 12 GB**, Oracle Linux 9 | ✅ (1,500 OCPU-hrs + 9,000 GB-hrs/mo; 2×730=1,460 and 12×730=8,760 both fit) |
| Boot volume | 50 GB | ✅ (200 GB block-storage allowance) |
| Network | 1 VCN, 1 public subnet, internet gateway, route table, 1 NSG | ✅ |
| Public IP | 1 ephemeral, on the VM's VNIC | ✅ |
| Object storage | `kms-{env}-data` + `kms-{env}-audit` buckets | ✅ (20 GB + 50k API requests/mo) |
| Key management | 1 Vault (DEFAULT), 2 AES keys, 5 secrets | ✅ (150 secrets; software key versions free) |
| Database | MongoDB Atlas **M0**, external, EU region | ✅ (Atlas's own free tier) |
| **Not provisioned** | Container Instances, OCI Cache, WAF, Load Balancer | — |

### On-VM composition (`deploy/docker-compose.yml`)

| Container | Role | Memory budget |
|---|---|---|
| `caddy` | TLS termination (Let's Encrypt), hostname routing, security headers | 128 MB |
| `api` | `apps/api` (tenant realm) | 1 GB |
| `portal-api` | `apps/portal-api` (platform-admin realm) | 512 MB |
| `web` | `apps/web` (Next.js) | 1 GB |
| `redis-app` | sessions/lockout/permission cache — `--maxmemory-policy volatile-lru` | 512 MB |
| `redis-queue` | BullMQ — `--maxmemory-policy noeviction` | 512 MB |
| | **Total** | **~3.7 GB of 12 GB** |

Deliberately **not** deployed: `worker-parse`, `worker-ai`, `worker-index`, `clamd` — all Phase 3,
deferred. Their absence is the point, not an omission.

### Architecture (`arm64`)

Ampere A1 is ARM. **Proven 2026-08-18**: `docker build --platform linux/arm64` of `apps/api/Dockerfile`
succeeds, the resulting image reports `arm64/linux`, and a booted container starts Nest, loads
`argon2`'s native binding, and actually hashes a password (`$argon2id$...`) — no exec-format error, no
crash. `node:22-slim` and `gcr.io/distroless/nodejs22-debian12` are both multi-arch as expected;
`argon2` (the only native dependency, `libs/auth`) loads its prebuilt arm64 binding correctly.

Proving this surfaced a real, unrelated bug in `apps/api/Dockerfile`, fixed the same day: the final
stage copied `apps/api/node_modules` and the workspace root `node_modules` into two renamed,
side-by-side folders, which breaks pnpm's relative workspace symlinks (they climb up into a shared
`.pnpm` store and into sibling `libs/*` packages by relative path). The fix preserves the build stage's
exact directory layout in the final stage (`WORKDIR /repo/apps/api`, `COPY ... /repo/node_modules`,
`COPY ... /repo/libs`) instead of flattening it, plus `ENV CI=true` (pnpm refuses to reinstall
`node_modules` with no TTY, unrelated to arm64) and a missing root `.dockerignore` (the build context
was shipping the full 5.6 GB working tree, including `.worktrees/`, on every build). All three bugs
would have hit an amd64 build identically — arm64 itself was never the problem.

Same day, `apps/portal-api/Dockerfile` got the identical fix (same bug, same shape) and
`apps/web/Dockerfile` was rebuilt around Next's `output: 'standalone'` (`next.config.mjs` sets
`outputFileTracingRoot` to the monorepo root) instead of the copy-`/repo`-layout workaround — Next
traces only the dependencies actually used into a self-contained bundle, sidestepping the pnpm-symlink
problem rather than working around it. All three images (`api`, `portal-api`, `web`) are now
build-and-boot verified on `arm64`: each starts its server (Nest bootstrapping / Next's `Ready in
321ms`), and `web`'s standalone server was confirmed serving a real rendered page
(`curl localhost:.../login` → HTTP 200, Hebrew RTL markup, `/_next/static` assets resolving).

### Storage provider

`OciStorageProvider` (built under ADR-0014) is unchanged and still correct — Object Storage is used
identically here.

**`S3StorageProvider` added 2026-08-17** (was a follow-up; built immediately, since it is the single
highest-leverage thing for exit-cost). One class covers AWS S3, Hetzner Object Storage, OCI Object
Storage (via its S3-compatibility endpoint), Cloudflare R2, Backblaze B2 and MinIO — so "which cloud
holds our files" becomes an `S3_ENDPOINT` config change rather than a code change. Selected via
`S3_DATA_BUCKET`/`S3_REGION`/`S3_ENDPOINT`/`S3_FORCE_PATH_STYLE`, taking precedence over the GCS and
OCI bindings in `documents.providers.ts` (first-match-wins; a deployment targets one cloud).

It also **does not** inherit `OciStorageProvider`'s Content-Disposition limitation: S3 presigned URLs
accept `ResponseContentDisposition` at signing time, so the caller's display filename is honoured per
download, matching `GcsStorageProvider` and satisfying ADR-0006 properly rather than via the generic
`attachment` fallback OCI PARs force. That makes S3 the *preferred* binding on capability grounds,
not only portability grounds.

### What is explicitly given up

- **No HA.** Single VM, single AD. VM loss = full outage until restore. Accepted pre-revenue;
  PRD §13's 99.5% is a launch target and is **not** met by this topology, stated plainly rather than
  implied.
- **No managed backups.** Atlas M0 has no automated backup either. Object Storage is the system of
  record for files; Mongo data needs a manual/scripted `mongodump` until Atlas is upgraded.
- **No WAF.** Caddy provides TLS and security headers, not OWASP-CRS inspection. Re-enter via
  ADR-0014's WAF (or Caddy+Coraza) before real customer data lands.
- **Free-tier ceilings are real limits**: 20 GB Object Storage, 50k API requests/month, 10 TB egress.
  Exceeding any of them starts billing. See the cost table below.

## Consequences

- **Positive:** $0/month against ~$240/month; deferred-phase infrastructure is no longer provisioned;
  hostname routing and the Redis eviction split both work for the first time; the deployment is
  portable to Hetzner or any VPS in one file, so Oracle cutting the free tier again is a config
  change, not an architecture change.
- **Negative / accepted risks:** single point of failure with no automated recovery; self-hosted
  Redis and Caddy are new ops surface; PRD §13's availability targets are not met and must not be
  claimed until ADR-0014's topology is applied.
- **Follow-ups:** a `mongodump` backup script while on Atlas M0; revisit this ADR the moment there is a
  paying customer or real document volume — the trigger to apply ADR-0014 is *revenue or data*, not
  calendar time. (`S3StorageProvider` — **done 2026-08-17**; arm64 build — **proven 2026-08-18**, see
  above.)
- **Exit cost, deliberately kept low.** With `S3StorageProvider` in place, migrating to AWS or Hetzner
  is: `rclone sync` the two buckets, copy 5 secret values, rewrite ~20 Terraform resources, redeploy
  the same `docker-compose.yml`. Atlas is external and needs no migration at all; Redis is ephemeral
  by design (ADR-0003/0004) and needs none either. The one latent lock-in risk to design around is
  `KmsKeyProvider`: TOTP secrets are currently envelope-encrypted under a portable
  `KMS_MASTER_KEY_HEX`, and switching to a cloud KMS with a **non-exportable** key would make every
  TOTP secret decryptable only inside that cloud — plan that re-encryption path *when* building
  `OciKeyProvider`, not after.
