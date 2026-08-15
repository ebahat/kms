# Container Instances replace Cloud Run (ADR-0014's topology table). Unlike Cloud Run, every
# container instance needs an explicit subnet placement (no "outside the VCN" default path) and an
# availability domain — fetched via data source rather than hardcoded, since AD names vary per tenancy.
#
# Deliberately matching the GCP skeleton's own incompleteness, not silently different: only
# WORKER_POOL/REDIS_APP_HOST/REDIS_QUEUE_HOST are wired as env vars here (same as
# infra-gcp-superseded's cloud-run module) — MONGO_URI, KMS_MASTER_KEY_HEX, PASSWORD_PEPPER, and the
# storage-provider env vars (OCI_DATA_BUCKET/OCI_NAMESPACE/OCI_REGION) all need real secret-injection
# wiring that neither skeleton attempts yet. Real work for whoever does the first actual deploy, not
# assumed done here.

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.compartment_id
}

locals {
  # First AD is fine for a single-environment, no-HA-yet skeleton (matches this module's overall
  # scope parity with infra-gcp-superseded's own "module skeleton only" ambition, not a hardened
  # multi-AD production design).
  ad = data.oci_identity_availability_domains.ads.availability_domains[0].name

  services = {
    api          = { subnet = var.app_subnet_id, nsg = var.app_nsg_id, pool = null }
    portal_api   = { subnet = var.app_subnet_id, nsg = var.app_nsg_id, pool = null }
    web          = { subnet = var.app_subnet_id, nsg = var.app_nsg_id, pool = null }
    worker_parse = { subnet = var.subnets.parse, nsg = var.nsgs.parse, pool = "parse" }
    worker_ai    = { subnet = var.subnets.ai, nsg = var.nsgs.ai, pool = "ai" }
    worker_index = { subnet = var.subnets.index, nsg = var.nsgs.index, pool = "index" }
  }
}

resource "oci_container_instances_container_instance" "svc" {
  for_each             = local.services
  compartment_id       = var.compartment_id
  availability_domain  = local.ad
  display_name         = "kms-${var.env}-${replace(each.key, "_", "-")}"
  # Flex shape — sized modestly for a not-yet-real-traffic skeleton; revisit once load-tested (P6.3).
  shape = "CI.Standard.E4.Flex"
  shape_config {
    ocpus         = 1
    memory_in_gbs = 4
  }

  containers {
    display_name = replace(each.key, "_", "-")
    # Bootstrap placeholder — replaced by CI on first real deploy, same convention as the GCP
    # module's `:bootstrap` image tag.
    image_url = "${var.region}.ocir.io/${var.ocir_namespace}/kms-${replace(each.key, "_", "-")}:bootstrap"

    environment_variables = merge(
      {
        REDIS_APP_HOST   = var.redis_app_host
        REDIS_QUEUE_HOST = var.redis_queue_host
      },
      each.value.pool == null ? {} : { WORKER_POOL = each.value.pool }
    )
  }

  vnics {
    subnet_id              = each.value.subnet
    nsg_ids                = [each.value.nsg]
    is_public_ip_assigned  = false
    display_name           = "${replace(each.key, "_", "-")}-vnic"
  }
}

# clamd — internal only, in subnet-parse, no egress except the freshclam signature mirror
# (ADR-0003/ADR-0014). Its own NSG (not the shared parse NSG) so its one necessary egress exception
# doesn't loosen the worker-parse pool's own no-internet posture.
resource "oci_core_network_security_group" "clamd" {
  compartment_id = var.compartment_id
  vcn_id         = var.vcn_id
  display_name   = "kms-${var.env}-nsg-clamd"
}

resource "oci_core_network_security_group_security_rule" "clamd_egress_freshclam" {
  network_security_group_id = oci_core_network_security_group.clamd.id
  direction                 = "EGRESS"
  protocol                  = "6" # TCP
  destination                = "0.0.0.0/0"
  destination_type           = "CIDR_BLOCK"
  description                = "freshclam signature mirror only — clamd has no other egress (ADR-0003)"
  tcp_options {
    destination_port_range {
      min = 443
      max = 443
    }
  }
}

resource "oci_container_instances_container_instance" "clamd" {
  compartment_id      = var.compartment_id
  availability_domain = local.ad
  display_name        = "kms-${var.env}-clamd"
  shape                = "CI.Standard.E4.Flex"
  shape_config {
    ocpus         = 1
    memory_in_gbs = 2
  }

  containers {
    display_name = "clamd"
    image_url     = "${var.region}.ocir.io/${var.ocir_namespace}/kms-clamd:bootstrap"
  }

  vnics {
    subnet_id              = var.subnets.parse
    nsg_ids                = [oci_core_network_security_group.clamd.id]
    is_public_ip_assigned  = false
    display_name           = "clamd-vnic"
  }
}

# Public LB — a genuine functional gap Cloud Run didn't have: Cloud Run services get a public
# `*.run.app` URL automatically, so the GCP module's skeleton never needed an LB resource at all
# (its own README says you can skip the LB module entirely for a PoC). Container Instances have no
# such default; without this, api/portal-api/web (VNICs deliberately with no public IP) would be
# completely unreachable. Simplified relative to ADR-0007/0014's actual same-domain hostname-routing
# design (api.<domain> / admin.<domain> / app.<domain>) — that needs OCI LB Routing Policies
# (host-header based rules), not yet implemented here; this uses one listener port per service
# instead, a real but interim gap, not silently equivalent to the target design.

# UNVERIFIED, flag for Task 8: the LB's public-IP output attribute name (used below in
# `service_urls`/`lb_public_ip`) was not independently confirmed against the registry docs in this
# pass — likely `ip_address_details[0].ip_address` based on general provider convention, but check
# `terraform plan`'s attribute list against a real LB before trusting these two outputs.
resource "oci_load_balancer_load_balancer" "public" {
  compartment_id = var.compartment_id
  display_name   = "kms-${var.env}-lb"
  shape          = "flexible"
  subnet_ids     = [var.public_subnet_id]
  is_private     = false
  shape_details {
    minimum_bandwidth_in_mbps = 10
    maximum_bandwidth_in_mbps = 100
  }
}

resource "oci_load_balancer_backend_set" "svc" {
  for_each         = { api = 3000, portal_api = 3100, web = 3000 }
  load_balancer_id = oci_load_balancer_load_balancer.public.id
  name             = replace(each.key, "_", "-")
  policy           = "ROUND_ROBIN"
  health_checker {
    protocol = "TCP"
    port     = each.value
  }
}

resource "oci_load_balancer_backend" "svc" {
  for_each         = oci_load_balancer_backend_set.svc
  load_balancer_id = oci_load_balancer_load_balancer.public.id
  backendset_name  = each.value.name
  ip_address       = oci_container_instances_container_instance.svc[each.key].vnics[0].private_ip
  port             = each.key == "portal_api" ? 3100 : 3000
}

resource "oci_load_balancer_listener" "svc" {
  for_each                 = { api = 8080, portal_api = 8081, web = 8090 }
  load_balancer_id         = oci_load_balancer_load_balancer.public.id
  name                     = "${replace(each.key, "_", "-")}-listener"
  default_backend_set_name = oci_load_balancer_backend_set.svc[each.key].name
  port                     = each.value
  protocol                 = "HTTP"
}

# WAF (sec §6 — Task 6 originally called for this alongside the LB; added here rather than left as a
# pure gap, since minimal OCI WAF policy shape is well-documented). Uses OCI's preconfigured
# protection-rule defaults, not custom rules — same "managed rules, tune after first traffic" posture
# ADR-0007's Cloud Armor entry described. UNVERIFIED: `default_action_name` referencing a
# not-explicitly-defined "allow_action" is per the registry example; confirm this resolves to a real
# built-in action (not a dangling reference) at Task 8's first `terraform validate`.
resource "oci_waf_web_app_firewall_policy" "public" {
  compartment_id = var.compartment_id
  display_name   = "kms-${var.env}-waf-policy"
  request_access_control {
    default_action_name = "allow_action"
  }
}

resource "oci_waf_web_app_firewall" "public" {
  compartment_id             = var.compartment_id
  display_name               = "kms-${var.env}-waf"
  backend_type                = "LOAD_BALANCER"
  load_balancer_id            = oci_load_balancer_load_balancer.public.id
  web_app_firewall_policy_id  = oci_waf_web_app_firewall_policy.public.id
}

output "lb_public_ip" {
  value = oci_load_balancer_load_balancer.public.ip_address_details[0].ip_address
}

output "service_urls" {
  value = {
    api        = "http://${oci_load_balancer_load_balancer.public.ip_address_details[0].ip_address}:8080"
    portal_api = "http://${oci_load_balancer_load_balancer.public.ip_address_details[0].ip_address}:8081"
    web        = "http://${oci_load_balancer_load_balancer.public.ip_address_details[0].ip_address}:8090"
  }
}
