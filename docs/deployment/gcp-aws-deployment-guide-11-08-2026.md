# Deploying the system on GCP, AWS, and OCI

Status: PoC/staging-grade walkthrough, not a production hardening guide. For the full production
security posture (Cloud Armor/WAF, Workload Identity Federation, per-service least-privilege IAM,
Secret Manager, CMEK rotation, VPC Service Controls, EU-residency justification) see
`docs/adr/0007-hosting-topology-gcp.md` and `docs/security_requirements_v01.md`. This doc exists to
answer "how do I stand this up somewhere and see it run," for GCP (the documented/decided path), AWS,
and OCI (neither AWS nor OCI is a settled decision — see the note at the top of each section).

Scope note: this describes what's on `main` today (Phase 0+1: auth spine, tenant-admin, portal-api,
unstyled Next.js UI). The calendar/kanban/notifications work (Phase 2A) lives on the
`phase-2a-calendar-kanban` branch and isn't merged yet — if you deploy that branch instead, the same
steps apply, just build from it.

## What the app actually needs, regardless of cloud

Four deployables, each with an existing multi-stage Dockerfile (distroless, non-root) already in
the repo:

| App | Dockerfile | Default port | Purpose |
|---|---|---|---|
| `apps/api` | `apps/api/Dockerfile` | 3000 | Tenant-facing API |
| `apps/portal-api` | `apps/portal-api/Dockerfile` | 3100 | Platform-admin API (separate realm, ADR-0004) |
| `apps/worker` | `apps/worker/Dockerfile` | n/a (queue consumer) | Selects pool via `WORKER_POOL=parse\|ai\|index` — not yet wired to real work in Phase 0+1, safe to skip for a pure-API PoC |
| `apps/web` | `apps/web/Dockerfile` | 3000 (set `PORT`) | Next.js UI, RTL, calls the two APIs by URL |

Backing services, both clouds:

- **MongoDB Atlas** — used as-is on either cloud. Atlas is not something you self-host here; create
  an Atlas project + cluster (M10+ for real vector/Atlas Search indexes, or the free M0 tier for a
  pure smoke-test PoC) and hand the app a standard `mongodb+srv://` connection string via `MONGO_URI`.
  Production topology uses Private Service Connect into GCP specifically (ADR-0007) — skip that for
  a PoC and just use Atlas's public/network-access-list connection, which works identically from GCP
  or AWS.
- **Redis** — plain `ioredis` client, connects via `REDIS_APP_HOST` (see `apps/api/src/redis.provider.ts`).
  No managed-service-specific code; any reachable Redis 6+ works (a single small instance is enough
  for a PoC — sessions + login-lockout counters + permission cache all live here).
- **Object storage** — the one real cloud-specific dependency. `StorageProvider` (`apps/api/src/documents/storage/storage-provider.ts`)
  is a 4-method interface; the only production implementation shipped today is `GcsStorageProvider`
  (`@google-cloud/storage`). GCP: use it directly. AWS: no `S3StorageProvider` exists yet — see the
  AWS section.
- **KMS envelope encryption** (TOTP secrets, backup codes) — `KmsKeyProvider` interface
  (`libs/auth/src/kms-envelope.ts`). The only implementation currently wired into `apps/api` is
  `LocalMasterKeyProvider`, an AES-256-GCM wrap under a single master key read from
  `KMS_MASTER_KEY_HEX`. There is no Cloud-KMS-backed implementation in the codebase yet on either
  cloud — this is genuinely cloud-agnostic today, not a GCP-only gap. Fine for a PoC as-is; swap in a
  real KMS-backed provider before handling real user data (generate the 64-hex-char master key with
  `openssl rand -hex 32` and treat it as a secret either way).

Required env vars (from `apps/api`/`apps/portal-api`, grepped from source):

```
MONGO_URI              mongodb+srv://... (Atlas connection string)
REDIS_APP_HOST         redis host (port defaults via ioredis)
KMS_MASTER_KEY_HEX     64 hex chars (32 bytes) — openssl rand -hex 32
PASSWORD_PEPPER         Argon2id pepper, treat as a secret
GCS_DATA_BUCKET         GCP only — bucket name for GcsStorageProvider
SEED_ADMIN_EMAIL        first-account bootstrap (apps/api and apps/portal-api each run their own seed)
SEED_ADMIN_PASSWORD
SEED_TENANT_NAME        apps/api's seed only
PORT                    optional, defaults per Dockerfile
```

`apps/web` needs `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_PORTAL_API_URL` pointing at the two API
services' public URLs.

Bootstrap: after the API containers are up and can reach Mongo, run each app's seed once
(`pnpm run seed` locally against the deployed `MONGO_URI`, or `node dist/bootstrap/seed.js` inside
the container) — idempotent on email, creates the first tenant admin / platform admin.

---

## GCP — the documented path (ADR-0007)

This is the only cloud with real, in-repo IaC (`infra/`, Terraform), matching the accepted topology:
Cloud Run for all six services, Memorystore (Redis) ×2, GCS ×2 buckets, Cloud KMS, Secret Manager,
global LB + Cloud Armor. `infra/README.md` is explicit that `terraform apply` is **not runnable
as-is** — it needs values only you can supply.

1. **Prerequisites**
   - A GCP project (billing enabled) — for a PoC, one project is fine; ADR-0007's `kms-staging`/`kms-prod`
     split is a production-separation concern, skip it here.
   - `gcloud` CLI authenticated, Terraform installed.
   - An Atlas project/cluster + API keys (Atlas is managed outside this Terraform).
   - A domain you control, if you want the LB path (`api.<domain>`, `admin.<domain>`, `app.<domain>`).
     For a quick PoC you can skip the domain and just hit each Cloud Run service's `*.run.app` URL
     directly instead of standing up the LB module.

2. **Fill `infra/terraform.tfvars`** (gitignored) with: project id, region (`europe-west1` per the
   ADR, or any region if EU residency doesn't matter for your PoC), billing account id, domain (if
   using the LB), Atlas project/org id + API keys.

3. **Apply**
   ```bash
   cd infra
   terraform init
   terraform plan   # review — this creates VPC/subnets, Memorystore x2, GCS x2 buckets, Cloud KMS keyring, Secret Manager, 6 Cloud Run services (bootstrap image placeholder)
   terraform apply
   ```
   The Cloud Run services deploy with a placeholder `gcr.io/${project}/kms-<service>:bootstrap` image
   — they won't serve real traffic until step 4 pushes a real image.

4. **Build and push images** (CI does this via Workload Identity Federation in the real pipeline;
   manually for a PoC):
   ```bash
   gcloud auth configure-docker
   for app in api portal-api worker web; do
     docker build -f apps/$app/Dockerfile -t gcr.io/$PROJECT_ID/kms-$app:poc .
     docker push gcr.io/$PROJECT_ID/kms-$app:poc
     gcloud run deploy kms-staging-$app --image gcr.io/$PROJECT_ID/kms-$app:poc --region $REGION
   done
   ```

5. **Wire secrets.** Put `MONGO_URI`, `KMS_MASTER_KEY_HEX`, `PASSWORD_PEPPER` into Secret Manager
   (the `infra/modules/secrets` module already provisions the keyring/secret slots) and reference
   them as Cloud Run secret-mounted env vars rather than plaintext `--set-env-vars`, even for a PoC —
   it's no extra effort and avoids the secrets ending up in `gcloud` shell history / Cloud Run
   revision metadata.

6. **Seed and verify.** Run the seed script against the deployed `MONGO_URI` (locally, or as a
   one-off Cloud Run job), then hit the API's health endpoint and log in through `apps/web`.

7. **Storage**: `GCS_DATA_BUCKET` is already provisioned by the `infra/modules/gcs` module — no code
   changes needed, `GcsStorageProvider` is the production binding.

---

## AWS — not a settled architecture decision; this is a from-scratch mapping

There is no AWS ADR and no AWS Terraform in this repo. ADR-0007 explicitly chose GCP (Vertex AI's
EU-residency guarantee was a deciding factor for the *production* system once the AI/chat features
land — see the ADR's "Revisited 2026-08-02" note). Nothing here should be read as changing that
decision; this section exists only because you asked for AWS PoC instructions specifically, and the
app layer has no hard GCP lock-in for the parts built so far. If you later want AWS as a real second
target, that deserves its own ADR, not just this doc.

**One required code change**: write an `S3StorageProvider` implementing the existing `StorageProvider`
interface (`apps/api/src/documents/storage/storage-provider.ts`) using `@aws-sdk/client-s3` +
`@aws-sdk/s3-request-presigner` for `getSignedDownloadUrl`. Mirror `GcsStorageProvider`'s shape
exactly — same 4 methods, same `attachment`-forcing `Content-Disposition` behavior (sec §4.4 requires
files are never rendered inline). This is a small, self-contained class; nothing else in the app
needs to change since callers only depend on the interface. Everything else below assumes this class
exists and is wired into `apps/api`'s `storageProviderProvider` factory in place of `GcsStorageProvider`.

Topology mapping (ADR-0007's GCP component → AWS equivalent):

| ADR-0007 component | AWS equivalent |
|---|---|
| Cloud Run (6 services) | ECS Fargate services (closest match — no cluster to manage, per-service task) behind an ALB. App Runner is an alternative but has weaker VPC-egress control for the worker pools' subnet-isolation posture. |
| VPC + per-pool subnets + firewall egress rules | VPC + one subnet per worker pool + security groups (parse pool: no `0.0.0.0/0` egress rule, matches ADR-0003's no-internet requirement) |
| Memorystore (Redis) ×2 | ElastiCache for Redis, two instances/replication groups (same split rationale as ADR-0007: session/permission cache tolerates eviction, BullMQ queue must not) |
| GCS ×2 buckets | S3 ×2 buckets (data + audit), SSE-KMS |
| Cloud KMS | AWS KMS — only needed if you build a real `KmsKeyProvider` implementation; `LocalMasterKeyProvider` with the master key in Secrets Manager is a legitimate PoC-grade alternative that requires zero new code |
| Secret Manager | AWS Secrets Manager (or SSM Parameter Store for a cheaper PoC) |
| Global external ALB + Cloud Armor | ALB + AWS WAF |
| Workload Identity Federation (CI→GCP) | GitHub Actions OIDC → IAM role assumption (`aws-actions/configure-aws-credentials`) |

Manual PoC steps (no IaC provided here — write Terraform/CDK once this is a real second target):

1. **VPC**: one VPC, 3 private subnets (parse/ai/index posture, mirroring `infra/modules/network`),
   1 public subnet for the ALB. NAT gateway only for the `ai` subnet (needs egress to LLM/OCR
   endpoints) and `index`/`parse` stay NAT-free per the same no/limited-internet posture as ADR-0007.

2. **ElastiCache**: two Redis replication groups (`redis-app`, `redis-queue`), private subnets, AUTH
   token enabled, TLS in transit.

3. **S3**: two buckets (data, audit), block public access, SSE-KMS with a customer-managed key,
   versioning on for the data bucket (cheap accidental-delete protection during a PoC).

4. **ECR**: push the same 4 Dockerfiles' images:
   ```bash
   aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$REGION.amazonaws.com
   for app in api portal-api worker web; do
     docker build -f apps/$app/Dockerfile -t $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/kms-$app:poc .
     docker push $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/kms-$app:poc
   done
   ```

5. **ECS Fargate**: one task definition + service per app, secrets injected via `secrets:` (pointing
   at Secrets Manager ARNs) not `environment:`, security groups scoped per the table above. ALB with
   two listeners/target groups for `api`/`portal-api` on separate hostnames (mirrors ADR-0007's
   admin-realm hostname separation, ADR-0004) and one for `web`.

6. **Atlas**: same as the GCP path — plain connection string, no PrivateLink needed for a PoC.

7. **Seed and verify**: same as GCP — run the seed script against `MONGO_URI`, hit the health
   endpoint, log in via `apps/web`.

### What's still genuinely GCP-shaped even after the S3 swap

- `apps/worker`'s three pools (parse/ai/index) and the ClamAV-in-VPC malware-scan step (ADR-0003)
  aren't implemented in application code yet on either cloud — nothing to port, but also nothing to
  demo beyond the API/UI surface until that lands.
- Vertex AI (chat/embeddings, ADR-0008) is likewise not implemented yet (`libs/ai-providers` is an
  empty package) — the EU-residency reasoning that anchored ADR-0007 to GCP doesn't have code to
  migrate yet either. If/when it does, that's the point to open a real "should we support AWS"
  decision rather than extending this doc further.

---

## OCI — not a settled architecture decision; explored 2026-08-15 for its cost/free-tier profile

Same status as the AWS section above: no ADR, no IaC in this repo. Explored because Oracle's Always
Free tier is unusually generous *and*, more importantly, OCI's paid rates for the two services this
app leans on hardest — Redis and egress — are meaningfully cheaper than GCP's at real volume, not just
free-tier-cheaper. Full reasoning and pricing sources:
`docs/deployment/oci-vs-gcp-cost-comparison-15-08-2026-research.md`. Nothing here changes ADR-0007's
GCP decision — if OCI becomes the real target, write a superseding ADR first, same rule as the AWS
section states.

**One required code change**: `OciStorageProvider` implementing `StorageProvider`
(`apps/api/src/documents/storage/storage-provider.ts`). Two options:

1. **Native** — `oci-sdk` (`oci-objectstorage` package), matching `GcsStorageProvider`'s shape exactly
   (same 4 methods, same `attachment`-forcing `Content-Disposition`). The proper long-term fit.
2. **Fast path** — OCI Object Storage exposes an S3-Compatibility API. If `S3StorageProvider` already
   exists from the AWS path, point its endpoint at
   `https://<namespace>.compat.objectstorage.<region>.oraclecloud.com` instead of AWS's endpoint and
   it works with zero new code. Caveat: the compatibility layer doesn't cover 100% of the S3 API —
   verify `putObject`/presigned-URL generation/`headObject`/`deleteObject` behave as expected before
   relying on it past a PoC.

Topology mapping (ADR-0007's GCP component → OCI equivalent):

| ADR-0007 component | OCI equivalent |
|---|---|
| Cloud Run (6 services) | Container Instances (serverless containers, closest match) — or Compute instances behind a Flexible Load Balancer if you want always-on rather than per-request billing |
| VPC + per-pool subnets + firewall egress rules | VCN + one subnet per worker pool + Network Security Groups (parse pool: no internet-routable route table entry, same no-internet posture as ADR-0003) |
| Memorystore (Redis) ×2 | OCI Cache with Redis ×2 (same split rationale: session/permission cache tolerates eviction, BullMQ queue must not) |
| GCS ×2 buckets | OCI Object Storage ×2 buckets (data + audit) |
| Cloud KMS | OCI Vault (KMS) — only needed for a real `KmsKeyProvider` implementation; `LocalMasterKeyProvider` with the master key in Vault-as-secret-store is a legitimate PoC alternative, same as the AWS section's equivalent note |
| Secret Manager | OCI Vault (secrets) |
| Global external LB + Cloud Armor | OCI Flexible Load Balancer + OCI WAF |
| Workload Identity Federation (CI→GCP) | GitHub Actions OIDC → OCI's identity federation, or a long-lived API signing key as a repo secret for a PoC |

Manual PoC steps (no IaC provided here — write real Terraform once this is a real second target,
mirroring `infra/`'s module structure):

1. **Sign up and set a budget alert first.** Oracle's Always Free allocation was cut once already
   (Ampere ARM halved from 4 OCPU/24 GB to 2 OCPU/12 GB in June 2026) — set a cost-tracking budget in
   the Console (Billing → Budgets) before provisioning anything, so an accidental paid-tier resource
   doesn't surprise you.

2. **Note your tenancy details**: tenancy OCID, home region, and create a compartment for this project
   (Identity → Compartments) rather than provisioning directly into the root compartment.

3. **Install and configure the OCI CLI**:
   ```bash
   bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)"
   oci setup config   # prompts for user OCID, tenancy OCID, region; offers to generate a new API signing RSA key pair — accept
   oci os ns get      # sanity check — should return your Object Storage namespace
   ```
   (Alternative: generate the API signing key via Console — Identity → Users → your user → API Keys —
   if you'd rather not let the CLI generate it.)

4. **VCN**: create with a public subnet (for the LB) and one private subnet per worker pool, mirroring
   `infra/modules/network`:
   ```bash
   oci network vcn create --compartment-id $COMPARTMENT_ID --display-name kms-poc-vcn --cidr-block 10.0.0.0/16
   oci network subnet create --compartment-id $COMPARTMENT_ID --vcn-id $VCN_ID --display-name kms-public --cidr-block 10.0.0.0/24
   oci network subnet create --compartment-id $COMPARTMENT_ID --vcn-id $VCN_ID --display-name kms-private --cidr-block 10.0.1.0/24 --prohibit-public-ip-on-vnic true
   ```

5. **OCI Cache with Redis** — two instances (`redis-app`, `redis-queue`), private subnet, in the
   Console (Databases → Cache with Redis) or via `oci redis redis-cluster create`; note the connection
   endpoint for each.

6. **Object Storage**: two buckets, matching `infra/modules/gcs`'s data/audit split:
   ```bash
   oci os bucket create --compartment-id $COMPARTMENT_ID --name kms-poc-data --namespace-name $NAMESPACE
   oci os bucket create --compartment-id $COMPARTMENT_ID --name kms-poc-audit --namespace-name $NAMESPACE
   ```

7. **Vault**: create a Vault + master encryption key (Identity & Security → Vault) if you're building
   the real `OciKeyProvider`; otherwise store `KMS_MASTER_KEY_HEX`/`MONGO_URI`/`PASSWORD_PEPPER` as
   Vault secrets either way, rather than plaintext env vars, same reasoning as the GCP path's step 5.

8. **Container Registry (OCIR)** and image push:
   ```bash
   docker login <region-key>.ocir.io -u '<tenancy-namespace>/<username>' -p '<auth-token>'   # generate an auth token: Identity → Users → your user → Auth Tokens
   for app in api portal-api worker web; do
     docker build -f apps/$app/Dockerfile -t <region-key>.ocir.io/$NAMESPACE/kms-$app:poc .
     docker push <region-key>.ocir.io/$NAMESPACE/kms-$app:poc
   done
   ```

9. **Deploy**: Container Instances for a quick PoC (`oci container-instances container-instance
   create`, one per app, referencing the OCIR image) — or Compute instances running the containers
   directly via `systemd`/Docker if you'd rather use the Always Free Ampere allocation for compute
   cost instead of Container Instances' per-use billing.

10. **Atlas**: identical to the GCP/AWS path — plain `mongodb+srv://` connection string, no
    PrivateLink/PrivateConnect needed for a PoC.

11. **Seed and verify**: same as the other two clouds — run the seed script against `MONGO_URI`, hit
    the health endpoint, log in through `apps/web`.

### What's still genuinely unimplemented regardless of cloud

Same caveat as the AWS section: `apps/worker`'s three pools and the ClamAV-in-VPC scan step (ADR-0003)
aren't built yet, and `libs/ai-providers` is still an empty package (ADR-0008). None of that is
cloud-specific work — there's nothing to port to OCI, but also nothing beyond the API/UI surface to
demo until Phase 3/4 land.
