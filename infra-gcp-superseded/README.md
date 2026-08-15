# Infra (Terraform) — ADR-0007 topology (SUPERSEDED)

**Superseded 2026-08-15 by [ADR-0014](../docs/adr/0014-hosting-topology-oci.md)** — production hosting
moved to OCI. This directory was never `terraform apply`'d (see below), so nothing is being migrated;
it's kept for historical reference only, moved aside from `infra/` (now the OCI Terraform) rather than
deleted, matching how this project keeps superseded ADRs rather than removing them. The live
infrastructure code is `infra/`.

**Status:** module skeleton only. `terraform apply` is not runnable yet — it needs real values this
repo cannot supply:

- GCP project id(s) for `kms-staging` / `kms-prod` (sec §10: full environment separation)
- Billing account id
- A domain for the LB (`api.<domain>`, `admin.<domain>`, `app.<domain>`)
- Atlas project/org id + API keys (Atlas itself is managed outside this Terraform; PSC peering
  parameters come from the Atlas side)

Fill these into `terraform.tfvars` (gitignored) before the first `terraform plan`.

## Layout

```
infra/
  versions.tf       provider requirements
  variables.tf      project/region/env inputs
  main.tf           root module wiring the pieces below
  modules/
    network/        VPC + snet-parse/snet-ai/snet-index + firewall egress rules
    redis/          Memorystore x2: redis-app (volatile-lru) + redis-queue (noeviction)
    gcs/            kms-{env}-data + kms-{env}-audit buckets, CMEK
    secrets/        Secret Manager + KMS keyring
    cloud-run/      six services + clamd, per-service SAs, subnet egress binding
```

## Sequencing

Apply against `kms-staging` first (Phase 0 exit criterion: hello-world revisions of all six
services + clamd deploy from CI). Production apply is a Phase 6 gate.
