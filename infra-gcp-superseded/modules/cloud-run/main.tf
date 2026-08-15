# One service account per service, scoped to exactly its resources (sec §6; ADR-0007).

locals {
  services = {
    api         = { subnet = null, egress = "PRIVATE_RANGES_ONLY" }
    portal_api  = { subnet = null, egress = "PRIVATE_RANGES_ONLY" }
    web         = { subnet = null, egress = "ALL_TRAFFIC" }
    worker_parse = { subnet = var.subnets.parse, egress = "ALL_TRAFFIC", pool = "parse" }
    worker_ai    = { subnet = var.subnets.ai,    egress = "ALL_TRAFFIC", pool = "ai" }
    worker_index = { subnet = var.subnets.index, egress = "ALL_TRAFFIC", pool = "index" }
  }
}

resource "google_service_account" "svc" {
  for_each     = local.services
  account_id   = "sa-${replace(each.key, "_", "-")}"
  display_name = "kms-${var.env} ${each.key} service account"
}

resource "google_cloud_run_v2_service" "svc" {
  for_each = local.services
  name     = "kms-${var.env}-${replace(each.key, "_", "-")}"
  location = var.region
  ingress  = each.key == "worker_parse" || each.key == "worker_ai" || each.key == "worker_index" ? "INGRESS_TRAFFIC_INTERNAL_ONLY" : "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.svc[each.key].email

    dynamic "vpc_access" {
      for_each = each.value.subnet == null ? [] : [1]
      content {
        network_interfaces {
          network    = var.network_id
          subnetwork = each.value.subnet
        }
        egress = each.value.egress
      }
    }

    containers {
      image = "gcr.io/${var.project_id}/kms-${replace(each.key, "_", "-")}:bootstrap" # replaced by CI on first deploy
      dynamic "env" {
        for_each = lookup(each.value, "pool", null) == null ? {} : { WORKER_POOL = each.value.pool }
        content {
          name  = env.key
          value = env.value
        }
      }
      env {
        name  = "REDIS_APP_HOST"
        value = var.redis_app_host
      }
      env {
        name  = "REDIS_QUEUE_HOST"
        value = var.redis_queue_host
      }
    }
  }
}

# clamd — internal ingress only, in snet-parse, no egress except freshclam mirror (ADR-0003/0007).
resource "google_service_account" "clamd" {
  account_id   = "sa-clamd"
  display_name = "kms-${var.env} clamd service account"
}

resource "google_cloud_run_v2_service" "clamd" {
  name     = "kms-${var.env}-clamd"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    service_account = google_service_account.clamd.email
    vpc_access {
      network_interfaces {
        network    = var.network_id
        subnetwork = var.subnets.parse
      }
      egress = "ALL_TRAFFIC"
    }
    containers {
      image = "gcr.io/${var.project_id}/kms-clamd:bootstrap"
    }
  }
}

output "service_urls" {
  value = { for k, s in google_cloud_run_v2_service.svc : k => s.uri }
}
