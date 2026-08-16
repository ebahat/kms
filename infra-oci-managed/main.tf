provider "oci" {
  region = var.region
  # Auth: defaults to the OCI config-file provider (`~/.oci/config`, set up via `oci setup config` —
  # see docs/deployment/gcp-aws-deployment-guide-11-08-2026.md's OCI section). CI should use a
  # different auth method (e.g. an OCI Resource Principal or a scoped API key stored as a secret) —
  # not decided yet, tracked as a Task 7 follow-up alongside the rest of the CI wiring.
}

module "network" {
  source         = "./modules/network"
  compartment_id = var.compartment_id
  env            = var.env
}

module "cache" {
  source         = "./modules/cache"
  compartment_id = var.compartment_id
  env            = var.env
  app_subnet_id  = module.network.subnets.app
  app_nsg_id     = module.network.nsgs.app
}

module "vault" {
  source         = "./modules/vault"
  compartment_id = var.compartment_id
  env            = var.env
}

module "object_storage" {
  source         = "./modules/object-storage"
  compartment_id = var.compartment_id
  namespace      = var.object_storage_namespace
  env            = var.env
  kms_key_id     = module.vault.storage_key_id
}

module "compute" {
  source            = "./modules/compute"
  compartment_id    = var.compartment_id
  region            = var.region
  env               = var.env
  vcn_id            = module.network.vcn_id
  public_subnet_id  = module.network.subnets.public
  app_subnet_id     = module.network.subnets.app
  app_nsg_id        = module.network.nsgs.app
  subnets           = { parse = module.network.subnets.parse, ai = module.network.subnets.ai, index = module.network.subnets.index }
  nsgs              = { parse = module.network.nsgs.parse, ai = module.network.nsgs.ai, index = module.network.nsgs.index }
  redis_app_host    = module.cache.app_host
  redis_queue_host  = module.cache.queue_host
  ocir_namespace    = var.object_storage_namespace
}
