# Infra (Terraform) — ADR-0015 topology (OCI Always Free, single VM)

**This is the active topology.** The managed-services topology (Container Instances, OCI Cache,
LB+WAF) lives in `infra-oci-managed/` — it is **not superseded**, it is the documented *scale-up*
target for when there is revenue and real data volume. See
[ADR-0015](../docs/adr/0015-pre-revenue-single-vm-topology.md) for why the starting topology is
different from the growth one.

**Everything here is Always Free.** Expected cost: **$0/month**, provided the ceilings below hold.

## Resources created (20 total — confirmed by a real `terraform plan`)

| Module | Resources | Always Free? |
|---|---|---|
| `network` | VCN, internet gateway, route table, public subnet, NSG + 4 rules | ✅ |
| `compute` | 1 × `VM.Standard.A1.Flex` (2 OCPU / 12 GB, 50 GB boot), public IP | ✅ |
| `object-storage` | `kms-{env}-data`, `kms-{env}-audit` buckets | ✅ |
| `vault` | 1 Vault, 2 AES keys, 5 secrets | ✅ |

**Not created** (all billable, all in `infra-oci-managed/`): Container Instances, OCI Cache with
Redis, WAF, Load Balancer.

## Free-tier ceilings — exceeding any of these starts real billing

| Resource | Allowance | This config uses |
|---|---|---|
| Ampere A1 compute | 1,500 OCPU-hrs + 9,000 GB-hrs per month | 1,460 + 8,760 (~3% headroom) |
| Block storage | 200 GB | 50 GB |
| Object Storage | 20 GB + **50,000 API requests/month** | grows with usage |
| Egress | 10 TB/month | grows with usage |
| Secrets | 150 | 5 |

The compute headroom is thin *by design* — 2 OCPU / 12 GB is the entire free allocation, so a second
instance of any size exceeds it. `modules/compute/main.tf` has a `precondition` that fails the plan
if `ocpus`/`memory_in_gbs` are raised above the free ceiling, so it can't happen by accident.

Object Storage API requests are the ceiling most likely to bite first (every upload, signed-URL
issuance, and deletion-verification check counts). **Set a budget alert** — Always Free bills the
overage rather than hard-stopping.

## Prerequisites

- OCI tenancy + compartment; `oci setup config` done (`~/.oci/config`)
- **`region` must be the tenancy's HOME region** — Always Free resources are only free there
- Object Storage namespace (`oci os ns get`)
- An SSH keypair (`ssh-keygen -t ed25519`) — the public key goes in `terraform.tfvars`
- Your own IP/CIDR for `ssh_ingress_cidr` (do not use `0.0.0.0/0`)
- A domain whose DNS you control

Copy `terraform.tfvars.example` → `terraform.tfvars` (gitignored) and fill it in.

## Apply

```bash
terraform init
terraform plan     # expect 20 to add, 0 to change, 0 to destroy
terraform apply
terraform output public_ip   # point DNS here, then see ../deploy/README.md
```

## Layout

```
infra/
  versions.tf        provider requirements (oracle/oci ~> 7.0)
  variables.tf        compartment/region/env/domain/namespace/ssh inputs
  main.tf             root module
  modules/
    network/          VCN + public subnet + NSG (80/443 open, 22 restricted)
    compute/          the Always Free A1 VM, cloud-init installs Docker only
    object-storage/   data + audit buckets (unchanged from the managed topology)
    vault/            KMS keys + secrets (unchanged from the managed topology)
```

`object-storage` and `vault` are reused as-is from the managed topology — both were already entirely
Always Free, so there was nothing to change.
