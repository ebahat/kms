# OCI infrastructure migration — 2026-08-15

**Status:** IN PROGRESS. Scoping resolved 2026-08-15 (see "Resolved scoping decisions" below) —
Frankfurt region, single environment, no OCI tenancy created yet (user will do that in parallel; Task
8's `terraform plan` waits on it, Tasks 1–7 don't).

**Scope:** Implements [ADR-0014](../adr/0014-hosting-topology-oci.md) (supersedes ADR-0007, rebinds
ADR-0006's cloud-specific primitives). Two deliverables: (1) an `OciStorageProvider` implementing the
existing `StorageProvider` interface, additive and env-var-gated like `GcsStorageProvider` already is;
(2) a new `infra/` Terraform layer targeting OCI, replacing the never-applied GCP modules. Explicitly
**excludes** actually running `terraform apply` against a live account — that needs the user's OCI
tenancy, compartment, and billing setup first (see `docs/deployment/gcp-aws-deployment-guide-11-08-2026.md`'s
OCI section for the account-setup runbook), and real resource creation is a cost-incurring, external
action outside what should happen without an explicit go-ahead per step.

**Sources:** ADR-0014, ADR-0006, `docs/deployment/oci-vs-gcp-cost-comparison-15-08-2026-research.md`,
existing `infra/` (GCP modules, for structural precedent — network/redis/gcs/secrets/cloud-run).

## Resolved scoping decisions (2026-08-15)

1. **Region: Frankfurt (`eu-frankfurt-1`)** — EU residency per PRD §3, largest OCI EU region.
2. **Environment split: single environment for now.** No prod/staging compartment split yet (unlike
   ADR-0007's two-project GCP split) — nothing is deployed, pre-revenue, add the split later when
   there's a real reason to test changes before prod. One compartment (`kms`) for everything.
3. **Terraform state backend**: not yet decided — check what `infra/`'s existing GCP version actually
   uses (Task 2 will verify) before picking the OCI equivalent (Object Storage, S3-compatible backend
   type).
4. **Account status: no OCI tenancy created yet.** User will do the account-setup steps from
   `docs/deployment/gcp-aws-deployment-guide-11-08-2026.md`'s OCI section in parallel. This blocks only
   Task 8 (`terraform plan` against something real) — Tasks 1–7 (code + HCL) don't need live
   credentials to write.

## Tasks

- [DONE] **Task 1 — `OciStorageProvider`**: implement `apps/api/src/documents/storage/storage-provider.ts`'s
  fourth binding (alongside `FakeStorageProvider`/`GcsStorageProvider`), using `oci-sdk`'s
  `oci-objectstorage` package. Same 4 methods (`putObject`, `getSignedDownloadUrl` via OCI
  pre-authenticated requests, `objectExists`, `deleteObject`), same `attachment`-forcing
  `Content-Disposition` + RFC 5987 filename encoding as `GcsStorageProvider`. Wire into
  `documents.providers.ts`'s `storageProviderProvider` factory, gated on a new env var
  (`OCI_DATA_BUCKET` or similar — exact name TBD at implementation time) parallel to `GCS_DATA_BUCKET`,
  zero behavior change when unset. Unit tests mirroring `storage-provider.spec.ts`'s existing coverage.
- [ ] **Task 2 — Terraform: network module**: VCN, per-worker-pool subnets (`subnet-parse`,
  `subnet-ai`, `subnet-index`, public subnet for the LB), Network Security Groups matching ADR-0007's
  egress posture per pool (parse: no internet route; ai: named endpoints only; index: Atlas +
  storage + cache only).
- [ ] **Task 3 — Terraform: object storage module**: two buckets (`kms-{env}-data`,
  `kms-{env}-audit`), matching ADR-0006's layout; WORM/retention rule on the audit bucket; lifecycle
  policy for the `artifacts/*` 7-day backstop (ADR-0006).
- [ ] **Task 4 — Terraform: cache module**: two OCI Cache with Redis instances (`redis-app`,
  `redis-queue`), private, AUTH + TLS, matching ADR-0007/0014's eviction-policy split.
- [ ] **Task 5 — Terraform: vault module**: OCI Vault + master encryption key (for the future
  `OciKeyProvider`, not blocking — `LocalMasterKeyProvider` remains the interim binding per ADR-0014's
  Follow-ups) + secret slots for `MONGO_URI`/`PASSWORD_PEPPER`/`KMS_MASTER_KEY_HEX`.
- [ ] **Task 6 — Terraform: compute module**: Compute/Container Instances for the 4 apps
  (api/portal-api/worker/web) + Flexible Load Balancer with the two-hostname split (`api.…`,
  `admin.…` per ADR-0004's realm separation) + WAF.
- [ ] **Task 7 — Wire together + docs**: root `infra/` `main.tf`/`variables.tf`/`terraform.tfvars.example`,
  `infra/README.md` rewrite for OCI prerequisites (mirrors the account-setup steps already in
  `docs/deployment/gcp-aws-deployment-guide-11-08-2026.md`), update
  `docs/architecture/system-overview.md`'s ADR index/diagrams to reference ADR-0014.
- [ ] **Task 8 — Final review**: `terraform validate` + `terraform plan` against a real (user-created)
  tenancy/compartment to confirm the HCL is structurally sound — this is the first point real OCI
  credentials are needed. Full review pass matching this project's established Task-8 precedent.

## Explicitly out of scope

- Actually running `terraform apply` (cost-incurring, needs the user's account) — Task 8 stops at
  `plan`, not `apply`; applying is a separate, explicit go-ahead.
- `OciKeyProvider` (KMS envelope encryption) — Follow-up per ADR-0014, `LocalMasterKeyProvider` stays
  the binding.
- Phase 3/4 workloads (parse/ai/index pools' actual container images) — the Terraform provisions the
  subnets/NSGs/compute slots per ADR-0014's topology, but there's no application code to deploy into
  them yet (Phase 3/4 remain deferred per the existing roadmap decision).
