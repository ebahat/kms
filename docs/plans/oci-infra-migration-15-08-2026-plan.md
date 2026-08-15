# OCI infrastructure migration — 2026-08-15

**Status:** DONE (2026-08-16). All 8 tasks complete on branch `oci-infra-migration` (off
`main@9856819`). `terraform plan` against the user's real OCI tenancy: 52 to add, 0 errors. Scoping
resolved 2026-08-15 — Frankfurt region, single environment. **`terraform apply` was not run** —
provisioning real resources needs a separate explicit go-ahead.

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
- [DONE] **Task 2 — Terraform: network module**: VCN, per-worker-pool subnets (`subnet-parse`,
  `subnet-ai`, `subnet-index`, public subnet for the LB, plus an `app` subnet for api/portal-api/web
  not originally called out in this task text but needed since Container Instances have no
  "outside the VCN" default the way Cloud Run does), NSGs, isolation enforced at the route-table
  level for the no-internet parse pool (no route out at all, not just a firewall-deny rule).
- [DONE] **Task 3 — Terraform: object storage module**: two buckets (`kms-{env}-data`,
  `kms-{env}-audit`), matching ADR-0006's layout (inline retention rules, not a separate resource —
  differs from GCS's shape but same effect). Found and fixed a real inconsistency while porting:
  `infra-gcp-superseded`'s own GCS resource set `versioning { enabled = true }`, contradicting
  ADR-0006's own decision table ("versioning off — the app owns versioning"); the OCI port follows the
  ADR. The `artifacts/*` 7-day lifecycle backstop was NOT ported — a real, acknowledged gap (not
  load-bearing: the index stage already deletes these directly per ADR-0006, this was
  belt-and-suspenders only), not silently equivalent.
- [DONE] **Task 4 — Terraform: cache module**: two OCI Cache with Redis clusters (`redis-app`,
  `redis-queue`). Eviction-policy parity (GCP's `noeviction`/`volatile-lru` split) is flagged
  UNVERIFIED — OCI Cache's equivalent mechanism wasn't confirmed in this pass, not silently assumed
  identical.
- [DONE] **Task 5 — Terraform: vault module**: OCI Vault + two KMS keys (TOTP envelope + storage
  encryption) + secret slots for the pepper/provider keys. `OciKeyProvider` application code remains a
  Follow-up, not blocking — `LocalMasterKeyProvider` stays the interim binding, matching ADR-0014.
- [DONE] **Task 6 — Terraform: compute module**: Container Instances for the 6 services (api/
  portal-api/web/worker-parse/worker-ai/worker-index) + clamd + a public LB + a WAF (managed
  protection rules via `oci_waf_web_app_firewall_policy`/`oci_waf_web_app_firewall`, default-allow —
  same "tune after first traffic" posture ADR-0007's Cloud Armor entry had). **Known gap, not silently
  closed**: the LB uses one listener port per service, not real hostname-based routing
  (`api.<domain>`/`admin.<domain>` — ADR-0004's realm split) — OCI LB Routing Policies would be the
  real mechanism, not yet implemented.
- [DONE] **Task 7 — Wire together + docs**: root `infra/` `main.tf`/`variables.tf`/
  `terraform.tfvars.example` written; `infra/README.md` rewritten for OCI prerequisites, with a
  "known gaps vs. GCP skeleton" section listing everything flagged UNVERIFIED/simplified above;
  `docs/architecture/system-overview.md`'s ADR index updated (0007 → Superseded, 0006 → rebound, 0014
  added). CI auth mechanism (OIDC vs. scoped API key) explicitly left undecided — noted inline in
  `main.tf`'s provider block comment, not silently assumed.
- [DONE] **Task 8 — Final review**: `terraform validate` + `terraform plan` run 2026-08-16 against
  the user's real OCI tenancy (compartment `...jds5jvcolzrduxxmfsyk5cidvotzl7mmdzsphracwzmbuqha4z7a`,
  region `eu-frankfurt-1`, namespace `axjceqpmgl6l` — confirmed live by `oci os ns get` authenticating
  successfully). `validate`: clean, zero errors. `plan`: **52 to add, 0 to change, 0 to destroy, 0
  errors, 0 warnings** — every module (network/cache/object-storage/vault/compute, including the
  security-review-corrected WAF) resolved cleanly, confirming every `UNVERIFIED`-flagged resource
  argument in the code is in fact real and correctly shaped against the live provider schema.
  Process note: the first `terraform plan` attempt was silently truncated to 81 of 1717 real lines by
  the `rtk` CLI proxy before it ever reached disk (confirmed via `wc -c`/`md5` on the truncated file —
  not a display artifact, the truncation marker was baked into the file itself) — re-ran via
  `rtk proxy terraform plan` to get the untruncated output before trusting a "clean" result; this
  matters because silently trusting a truncated view of a plan against a real, billable account would
  have been a real risk, not a cosmetic one. Plan output files deleted after review (contained the
  real compartment OCID and full resource attribute lists — not committed).
  **`terraform apply` was NOT run** — provisioning real, cost-incurring resources needs a separate,
  explicit go-ahead per this project's standing rule on hard-to-reverse/cost-incurring actions.

## Explicitly out of scope

- Actually running `terraform apply` (cost-incurring, needs the user's account) — Task 8 stops at
  `plan`, not `apply`; applying is a separate, explicit go-ahead.
- `OciKeyProvider` (KMS envelope encryption) — Follow-up per ADR-0014, `LocalMasterKeyProvider` stays
  the binding.
- Phase 3/4 workloads (parse/ai/index pools' actual container images) — the Terraform provisions the
  subnets/NSGs/compute slots per ADR-0014's topology, but there's no application code to deploy into
  them yet (Phase 3/4 remain deferred per the existing roadmap decision).
