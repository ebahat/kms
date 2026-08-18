provider "oci" {
  region = var.region
  # Auth: OCI config-file provider (`~/.oci/config`, via `oci setup config`).
}

module "network" {
  source           = "./modules/network"
  compartment_id   = var.compartment_id
  env              = var.env
  ssh_ingress_cidr = var.ssh_ingress_cidr
}

module "vault" {
  source         = "./modules/vault"
  compartment_id = var.compartment_id
  env            = var.env
  region         = var.region
  name_suffix    = var.vault_name_suffix
}

module "object_storage" {
  source         = "./modules/object-storage"
  compartment_id = var.compartment_id
  namespace      = var.object_storage_namespace
  env            = var.env
  kms_key_id     = module.vault.storage_key_id
  # Explicit, not just the kms_key_id reference: bucket creation needs the vault module's
  # object_storage_kms_access IAM policy too, which nothing else here forces an ordering against.
  depends_on = [module.vault]
}

module "compute" {
  source         = "./modules/compute"
  compartment_id = var.compartment_id
  env            = var.env
  subnet_id      = module.network.subnet_id
  nsg_id         = module.network.nsg_id
  ssh_public_key = var.ssh_public_key
}

output "public_ip" {
  description = "Point api.<domain>, admin.<domain>, and app.<domain> A-records at this before deploying — Caddy needs resolvable DNS to obtain Let's Encrypt certificates."
  value       = module.compute.public_ip
}

output "ssh_command" {
  value = module.compute.ssh_command
}

output "data_bucket" {
  value = module.object_storage.data_bucket
}

output "audit_bucket" {
  value = module.object_storage.audit_bucket
}
