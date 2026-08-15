# Infra (Terraform) — ADR-0014 topology (OCI)

**Status:** module skeleton only, ported from `infra-gcp-superseded/` (kept for historical reference,
not deleted — see [ADR-0014](../docs/adr/0014-hosting-topology-oci.md)). `terraform apply` is not
runnable yet — it needs real values this repo cannot supply, and this HCL has not been run through
`terraform validate`/`plan` at all (no `terraform` CLI or OCI credentials exist in this environment —
same caveat the GCP skeleton carried). Several resource arguments are flagged inline as unverified;
search this directory for `UNVERIFIED` before the first real `terraform validate`.

Prerequisites (see `docs/deployment/gcp-aws-deployment-guide-11-08-2026.md`'s OCI section for the full
account-setup runbook):

- An OCI tenancy with a budget alert set (Oracle's Always Free tier has already been cut once — don't
  assume it's permanent for anything long-term-load-bearing)
- A compartment created for this project (`compartment_id`)
- The tenancy's Object Storage namespace (`oci os ns get`) — reused for both the data/audit buckets
  and OCIR (they share a namespace)
- A domain for the LB (`api.<domain>`, `admin.<domain>`, `app.<domain>` — see the compute module's own
  note on why hostname-based routing isn't actually wired yet, only per-port listeners)
- An Atlas project/org id + API keys (Atlas itself is managed outside this Terraform, same as the GCP
  skeleton — no OCI PrivateLink equivalent is used at this scale, ADR-0014)

Fill these into `terraform.tfvars` (gitignored, see `terraform.tfvars.example`) before the first
`terraform plan`.

## Layout

```
infra/
  versions.tf       provider requirements (oracle/oci)
  variables.tf       compartment/region/env/domain/namespace inputs
  main.tf            root module wiring the pieces below
  modules/
    network/         VCN + subnet-parse/ai/index/app/public, NSGs, NAT+service gateway
    cache/            OCI Cache with Redis x2: redis-app + redis-queue
    object-storage/   kms-{env}-data + kms-{env}-audit buckets, KMS-encrypted
    vault/            OCI Vault: KMS keys (TOTP envelope, storage encryption) + secrets
    compute/          six Container Instances + clamd + a public LB + WAF (api/portal-api/web only)
```

## Known gaps vs. the GCP skeleton, not silently equivalent

- **Reachability**: Cloud Run services get a public URL automatically; Container Instances don't —
  this port includes an actual LB (the GCP skeleton didn't have one at all, deferred entirely). See
  the compute module's own comment for what's simplified about it (per-port listeners, not real
  hostname-based routing yet).
- **Redis eviction policy**: GCP's `redis_configs { maxmemory-policy = ... }` has no confirmed OCI
  Cache equivalent in this pass — flagged in the cache module, not silently assumed working.
- **`artifacts/*` 7-day lifecycle backstop** (ADR-0006): not ported to the object-storage module —
  the pipeline's index stage already deletes these directly, so this was always a belt-and-suspenders
  backstop, not load-bearing, but it's a real, deliberate omission, not an oversight to silently paper
  over.
- **Retention-rule locking, vault secret creation, LB/WAF output attributes and the WAF policy's
  `default_action_name` reference**: each flagged inline with `UNVERIFIED` where the exact behavior
  wasn't confirmed against the registry docs.

## Sequencing

Same as before: apply against the single environment first (no staging/prod split yet — ADR-0014
scoping decision), confirm hello-world container instances + the LB respond, then revisit whether a
staging split is worth adding before a real production cutover.
