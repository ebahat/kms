# Two OCI Cache with Redis clusters, same opposite-eviction-policy split as
# infra-gcp-superseded/modules/redis (design review 2026-07-10, finding 1) — an ingestion burst on
# the queue cluster must never evict app-cluster sessions.
#
# NOTE (unverified, flag for Task 8): OCI Cache with Redis exposes maxmemory-policy-equivalent
# behavior via a separate "Cache Config Set" resource, referenced by the optional
# `oci_cache_config_set_id` argument below — this module does not yet define that resource (argument
# names for it weren't verified against the registry docs in this pass). Both clusters currently use
# OCI Cache's own default eviction behavior; wiring a real config set to force noeviction on the queue
# cluster is a Follow-up, not silently assumed done.

resource "oci_redis_redis_cluster" "app" {
  compartment_id     = var.compartment_id
  display_name       = "kms-${var.env}-redis-app"
  node_count         = 1
  node_memory_in_gbs = 2
  software_version   = var.redis_software_version
  subnet_id          = var.app_subnet_id
  nsg_ids            = [var.app_nsg_id]
  cluster_mode       = "NONSHARDED"
}

resource "oci_redis_redis_cluster" "queue" {
  compartment_id     = var.compartment_id
  display_name       = "kms-${var.env}-redis-queue"
  node_count         = 1
  node_memory_in_gbs = 4
  software_version   = var.redis_software_version
  subnet_id          = var.app_subnet_id
  nsg_ids            = [var.app_nsg_id]
  cluster_mode       = "NONSHARDED"
}

output "app_host" {
  value = oci_redis_redis_cluster.app.primary_fqdn
}

output "queue_host" {
  value = oci_redis_redis_cluster.queue.primary_fqdn
}
