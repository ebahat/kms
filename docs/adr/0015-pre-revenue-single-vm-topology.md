# ADR-0015: Pre-Revenue Single-VM Topology (OCI Always Free)

**Status:** Accepted (2026-08-16)
**Date:** 2026-08-16
**Deciders:** Product owner (Ehud)
**Sources:** [ADR-0014](0014-hosting-topology-oci.md) (retargeted, not superseded), ADR-0006 (storage/serving),
ADR-0003 (worker pools — deferred), PRD §3 (EU residency), §13 (availability targets),
`docs/deployment/oci-vs-gcp-cost-comparison-15-08-2026-research.md`,
[Oracle Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
`docs/requirements_review_v01.md` (residency resolution log), live OCI API verification (2026-08-19),
[Ampere A1 Compute pricing](https://www.oracle.com/cloud/compute/arm/),
[OCI Key Management FAQ](https://www.oracle.com/security/cloud-security/key-management/faq/),
[OCI Storage Pricing Guide](https://ocispecialists.com/blog/oci-storage-pricing-guide/)

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

### Correction (2026-08-19): region is `il-jerusalem-1`, not `eu-frankfurt-1`

The first real `terraform apply` attempt (2026-08-18, against `eu-frankfurt-1`) surfaced two more real,
previously-unverified bugs — same pattern as the arm64 packaging bugs above, fixed the same way (find
by actually running it, not by inference):

- **`oci_vault_secret` needs `secret_content` or `enable_auto_generation`** — the prior "UNVERIFIED,
  flag for Task 8" note in `modules/vault/main.tf` had it right: OCI rejects an empty secret shell
  (`400-CannotParseRequest, Provide valid secret content or enable auto-generation`). Fixed by seeding
  a placeholder `secret_content` (`base64encode("placeholder-rotate-immediately-after-apply")`) with
  `lifecycle { ignore_changes = [secret_content] }`, so an out-of-band rotation to the real value isn't
  reverted by the next `apply`.
- **Object Storage has no default access to Vault keys.** Bucket creation with a customer-managed
  `kms_key_id` failed `404-NotAuthorizedOrFoundKmsKey` until an explicit IAM policy was added:
  `allow service objectstorage-<region> to use keys in compartment id <compartment>` (note the
  region-scoped service name — the bare `objectstorage` principal doesn't exist; OCI rejected it as
  `400-InvalidParameter`). This is `oci_identity_policy.object_storage_kms_access` in
  `modules/vault/main.tf` now, with an explicit `depends_on = [module.vault]` on the object_storage
  module call so a fresh `apply` always sequences it correctly.

Applying that policy is what surfaced the real finding: **`403-NotAllowed, Please go to your home
region MTZ`** — IAM policies are tenancy-wide resources, manageable only from the tenancy's home
region. A live query (`oci iam region-subscription list`) confirmed the actual home region is
**`il-jerusalem-1`** (Jerusalem), not `eu-frankfurt-1` as this ADR assumed throughout. Oracle's own
Always Free docs, quoted directly: **"Always Free resources must be created in the tenancy's home
region... If you create Always Free-eligible resources outside your home region, you will incur
standard charges."** Everything already applied in Frankfurt (VCN/subnet/NSG, a vault, 2 KMS keys, 5
secrets, and a VM that had briefly existed) was therefore not actually Always-Free-covered — a repeat,
smaller-scale version of ADR-0014's original free-tier mistake. **All of it was destroyed the same
day** (`terraform destroy`, 17 resources, confirmed clean) before any material charge could accrue;
pure networking resources (VCN/subnet/NSG/routes) are never billed in OCI regardless of region, so the
real exposure was limited to a partial day of a 2 OCPU/12GB instance plus a `DEFAULT` vault.

**Why `il-jerusalem-1` over staying in Frankfurt, or moving to Hetzner:**

| Option | Monthly cost | Latency (all-Israel user base) | Notes |
|---|---|---|---|
| `il-jerusalem-1` (chosen) | **$0** — genuinely the home region | Best — real in-country DC | Verified live: `VM.Standard.A1.Flex` (`billing-type: LIMITED_FREE`), Oracle Linux 9 aarch64 image, Object Storage, and Vault (`kms.il-jerusalem-1.oraclecloud.com`, 200 OK) all confirmed reachable |
| `eu-frankfurt-1` (previous) | ~$30 (compute ~$27.74 + boot volume ~$2.13 + storage ~$0.51; Vault/keys are free everywhere, not home-region-gated) | EU-DC latency to Israel | Only justification was PRD §3 EU residency |
| Hetzner (`CAX21`/`CAX31`) | ~$9–18 (€7.99–€15.99 + €0.50 IPv4) | **Worst** — no Middle East DC; ~180–320ms round-trip from Germany/Finland/US | Still the documented cloud-exit path (`S3StorageProvider`), not a hosting choice |

The residency requirement itself doesn't block this: the actual resolution log
(`docs/requirements_review_v01.md`, 2026-07-07) says **"EU region acceptable... Israel region not
required for MVP"** — a permission, not a prohibition. `eu-frankfurt-1` was inherited by default from
ADR-0007's earlier GCP `europe-west` choice, never re-checked against the tenancy's actual home region
once the project moved to OCI. Hosting in Israel for an Israeli-market product with an Israeli tenancy
plausibly satisfies data-residency concerns more directly than routing through the EU, not less.

**Decision:** `region` defaults to `il-jerusalem-1` in `variables.tf`; `deploy/docker-compose.yml`'s
`OCI_REGION` default and `deploy/README.md`'s OCIR login example were updated to match.

**Applied 2026-08-19.** All 21 resources live in `il-jerusalem-1`: `public_ip = 84.13.85.78`,
`ssh_command = ssh opc@84.13.85.78`. `terraform plan` afterward: "No changes. Your infrastructure
matches the configuration." Two more real bugs surfaced getting there, both fixed:

- **The `oracle/oci` provider honors `~/.oci/config`'s `region=` line over the `provider "oci" {
  region = var.region }` block's value**, for this auth method at least — setting `var.region` alone
  wasn't enough; resources kept creating in `eu-frankfurt-1` (confirmed by their OCID prefixes) until
  `~/.oci/config`'s own `region=` was also changed to `il-jerusalem-1`. Anyone re-running this apply
  from a fresh machine needs to `oci setup config` (or hand-edit the config file) with the home region
  before `terraform apply`, not just set `terraform.tfvars`.
- **`oci_objectstorage_bucket`'s `retention_rules.duration.time_unit` only accepts `YEARS` or
  `DAYS`** — `MONTHS` (the module's original value, "24mo") isn't a valid enum member, and OCI's error
  for it is an unhelpful `400-InvalidJSON` rather than a clear "invalid enum" message, so this needed
  an actual failed apply (twice — it silently rolled the bucket back out of Terraform state both times,
  leaving a same-named orphan bucket on OCI's side that had to be found and deleted by hand before
  retrying) to surface. Fixed as `time_amount = 2, time_unit = "YEARS"` — exactly equivalent to the
  intended 24 months, sec §12 item 7 is unaffected.

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

### Deployed to the VM (2026-08-19) — first real production boot

`deploy/docker-compose.yml` is running live on the VM: `api`, `portal-api`, `web`, `caddy`,
`redis-app`, `redis-queue` all `Up`, `api`'s `/health` returns `200 {"status":"ok"}` through a real
MongoDB Atlas M0 connection (EU region) and the Vault-sourced `PASSWORD_PEPPER`. Caddy's hostname
routing confirmed working (HTTP→HTTPS 308 redirect on `Host: api.bahat.co.il`) — TLS itself is still
pending real DNS.

Three more real, previously-unverified bugs surfaced getting here, none of them infra-config issues:

1. **`docker push` (this Mac's Docker Desktop client) is broken against `mtz.ocir.io`/
   `il-jerusalem-1.ocir.io`.** Consistently `unknown: Unauthorized` on a blob `HEAD` request, on both
   OCIR hostnames, with a freshly created and confirmed-`ACTIVE` auth token. Root-caused by manually
   replicating what `docker login`/`push` does over raw HTTP: the unscoped *and* the properly-scoped
   (`repository:.../kms-api:pull,push`) OAuth2 token exchanges both succeed cleanly (200, real JWT,
   correct scope granted) — OCIR's auth layer is entirely correct. The bug is client-side, specific to
   this Docker Desktop version's bearer-challenge handling against this registry. Worked around with
   `crane` (`brew install crane`; `docker save` to a tar, `crane push` the tar) — pushed all three
   images successfully. Plain `docker login`/`docker pull` on the VM's newer Docker CE (29.7.2) had no
   such issue, so this only affects the local build/push leg, not the VM.
2. **Oracle Linux 9 has no `docker`/`docker-compose-plugin` packages in its default repos at all** —
   that's Debian/Ubuntu `apt` package naming, not what OL9's `dnf` repos carry. Because `dnf install
   pkg1 pkg2` fails the whole transaction when any one package is missing, the original cloud-init's
   `packages: [docker, docker-compose-plugin]` silently failed *both* packages
   (`Unit file docker.service does not exist`) — cloud-init still reported `finished`, no obvious
   signal anything was wrong short of `cloud-init status --long`. Fixed in
   `modules/compute/main.tf` by adding Docker's own CentOS/RHEL-compatible repo
   (`download.docker.com/linux/centos/docker-ce.repo`) before installing — works on OL9 aarch64
   without modification. Applied by hand to the already-running VM (cloud-init only runs once at
   first boot, so a `terraform apply` alone wouldn't have picked up the fix retroactively).
3. **A real, previously-latent application bug**: `apps/api`'s `assertEditionCoverage` boot-time
   guard (ADR-0009 G2) failed — `FoldersController`, `GroupsController`, `EventsController`,
   `TasksController`, `CalendarController`, `NotificationPreferencesController` were all missing the
   required `@Edition()`/`@EditionExempt()` decorator, added when each was originally built but never
   actually caught because this specific assertion only runs at real app bootstrap, which no unit
   test suite exercises (254/254 tests were already green, build/lint clean — none of that touches
   this code path). This was the **first time the API has ever booted outside a test harness**. Fixed
   by adding `@Edition('kb')` to all six (this project has one edition in active scope); verified
   clean on a full local rebuild (`tsc --noEmit`, 254/254 unit tests) before rebuilding and
   redeploying the image.

None of these three are infra-topology issues — they're real gaps in things that had never actually
been exercised end-to-end before, exactly the category of finding this ADR's implementation phase has
repeatedly turned up (arm64 build, region, retention rules, and now this). Remaining before the stack
is reachable at its real domain: DNS (`api.`/`admin.`/`app.bahat.co.il` → `84.13.85.78`, owner-side)
so Caddy can obtain real Let's Encrypt certificates.
