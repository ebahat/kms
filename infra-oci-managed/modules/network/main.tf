# VCN + per-pool subnets with mutually exclusive egress postures (ADR-0003, ADR-0014).
# Mirrors infra-gcp-superseded/modules/network's structure and per-pool intent; the isolation
# mechanism differs (route-table-level "no route out" for parse, instead of GCP's firewall-deny-rule
# approach) — arguably more robust, since there's no internet path to accidentally allow via a
# misconfigured firewall rule when the route simply doesn't exist.

resource "oci_core_vcn" "vcn" {
  compartment_id = var.compartment_id
  display_name   = "kms-${var.env}-vcn"
  cidr_blocks    = ["10.0.0.0/16"]
  dns_label      = "kms${var.env}"
}

resource "oci_core_internet_gateway" "igw" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.vcn.id
  display_name   = "kms-${var.env}-igw"
}

# Shared NAT gateway for the ai/index pools — both need to reach external endpoints (AI/OCR
# providers; Atlas, which has no OCI PrivateLink equivalent at this scale per ADR-0014). The parse
# pool deliberately has no route to this at all (see its route table below).
resource "oci_core_nat_gateway" "nat" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.vcn.id
  display_name   = "kms-${var.env}-nat"
}

# In-region traffic to OCI Object Storage stays off the metered NAT path for the pools that need it.
# NOTE: this module (like infra-gcp-superseded before it) has not been run through `terraform
# validate`/`plan` — no OCI credentials or `terraform` CLI exist in this environment (same caveat the
# GCP skeleton carried). Argument names below were checked against the provider's registry docs, but
# the oci_core_services data-source usage specifically is the least-verified part of this module —
# confirm it at Task 8's first real `terraform validate`.
resource "oci_core_service_gateway" "svc_gw" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.vcn.id
  display_name   = "kms-${var.env}-svc-gw"
  services {
    service_id = data.oci_core_services.all.services[0].id
  }
}

data "oci_core_services" "all" {}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.vcn.id
  display_name   = "kms-${var.env}-public-rt"
  route_rules {
    destination       = "0.0.0.0/0"
    network_entity_id = oci_core_internet_gateway.igw.id
  }
}

# No route rules at all — subnet-parse has zero path to the internet or to OCI-native services
# outside the VCN, matching ADR-0003's "no internet" requirement (sec §4.4). It reaches clamd (in-VCN),
# OCI Cache, and the object-storage/vault modules' resources purely via local VCN routing.
resource "oci_core_route_table" "parse" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.vcn.id
  display_name   = "kms-${var.env}-parse-rt"
}

resource "oci_core_route_table" "ai_index" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.vcn.id
  display_name   = "kms-${var.env}-ai-index-rt"
  route_rules {
    destination       = "0.0.0.0/0"
    network_entity_id = oci_core_nat_gateway.nat.id
  }
  route_rules {
    destination       = data.oci_core_services.all.services[0].cidr_block
    destination_type  = "SERVICE_CIDR_BLOCK"
    network_entity_id = oci_core_service_gateway.svc_gw.id
  }
}

resource "oci_core_subnet" "public" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.vcn.id
  display_name   = "kms-${var.env}-public"
  cidr_block     = "10.0.0.0/24"
  route_table_id = oci_core_route_table.public.id
  dns_label      = "public"
}

resource "oci_core_subnet" "parse" {
  compartment_id             = var.compartment_id
  vcn_id                     = oci_core_vcn.vcn.id
  display_name               = "kms-${var.env}-subnet-parse"
  cidr_block                 = "10.0.1.0/24"
  route_table_id             = oci_core_route_table.parse.id
  prohibit_public_ip_on_vnic = true
  dns_label                  = "parse"
}

resource "oci_core_subnet" "ai" {
  compartment_id             = var.compartment_id
  vcn_id                     = oci_core_vcn.vcn.id
  display_name               = "kms-${var.env}-subnet-ai"
  cidr_block                 = "10.0.2.0/24"
  route_table_id             = oci_core_route_table.ai_index.id
  prohibit_public_ip_on_vnic = true
  dns_label                  = "ai"
}

resource "oci_core_subnet" "index" {
  compartment_id             = var.compartment_id
  vcn_id                     = oci_core_vcn.vcn.id
  display_name               = "kms-${var.env}-subnet-index"
  cidr_block                 = "10.0.3.0/24"
  route_table_id             = oci_core_route_table.ai_index.id
  prohibit_public_ip_on_vnic = true
  dns_label                  = "index"
}

# api/portal-api/web (Container Instances always need an explicit subnet, unlike Cloud Run's
# outside-the-VCN default path) — same NAT+service-gateway route as ai/index (needs Atlas + future
# email-provider/Vertex egress + Object Storage), reachable from the public subnet's LB only via NSG
# ingress rules, not a public IP on the VNIC itself.
resource "oci_core_subnet" "app" {
  compartment_id             = var.compartment_id
  vcn_id                     = oci_core_vcn.vcn.id
  display_name               = "kms-${var.env}-subnet-app"
  cidr_block                 = "10.0.4.0/24"
  route_table_id             = oci_core_route_table.ai_index.id
  prohibit_public_ip_on_vnic = true
  dns_label                  = "app"
}

resource "oci_core_network_security_group" "app" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.vcn.id
  display_name   = "kms-${var.env}-nsg-app"
}

resource "oci_core_network_security_group_security_rule" "app_ingress_from_lb" {
  network_security_group_id = oci_core_network_security_group.app.id
  direction                 = "INGRESS"
  protocol                  = "6" # TCP
  source                    = oci_core_subnet.public.cidr_block
  source_type                = "CIDR_BLOCK"
  description                = "api/portal-api/web accept traffic only from the LB's public subnet"
  tcp_options {
    destination_port_range {
      min = 3000
      max = 3100
    }
  }
}

# NSGs — defense in depth on top of the route-table isolation above (sec §4.4 layered posture).
# Egress-only rules per pool; the exact ai/index destination CIDRs are a placeholder (0.0.0.0/0:443)
# until ADR-0008 pins the real AI/OCR provider endpoints — same "replace once pinned" caveat the
# GCP module's firewall rules carried.
resource "oci_core_network_security_group" "parse" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.vcn.id
  display_name   = "kms-${var.env}-nsg-parse"
}

resource "oci_core_network_security_group" "ai" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.vcn.id
  display_name   = "kms-${var.env}-nsg-ai"
}

resource "oci_core_network_security_group_security_rule" "ai_egress_https" {
  network_security_group_id = oci_core_network_security_group.ai.id
  direction                 = "EGRESS"
  protocol                  = "6" # TCP
  destination                = "0.0.0.0/0"
  destination_type           = "CIDR_BLOCK"
  description                = "Placeholder — replace with pinned AI/OCR provider endpoint ranges (ADR-0008 follow-up)"
  tcp_options {
    destination_port_range {
      min = 443
      max = 443
    }
  }
}

resource "oci_core_network_security_group" "index" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.vcn.id
  display_name   = "kms-${var.env}-nsg-index"
}

resource "oci_core_network_security_group_security_rule" "index_egress_atlas" {
  network_security_group_id = oci_core_network_security_group.index.id
  direction                 = "EGRESS"
  protocol                  = "6" # TCP
  destination                = "0.0.0.0/0"
  destination_type           = "CIDR_BLOCK"
  description                = "Atlas (external, no OCI PrivateLink equivalent at this scale — ADR-0014)"
  tcp_options {
    destination_port_range {
      min = 27017
      max = 27017
    }
  }
}

output "vcn_id" {
  value = oci_core_vcn.vcn.id
}

output "subnets" {
  value = {
    public = oci_core_subnet.public.id
    parse  = oci_core_subnet.parse.id
    ai     = oci_core_subnet.ai.id
    index  = oci_core_subnet.index.id
    app    = oci_core_subnet.app.id
  }
}

output "nsgs" {
  value = {
    parse = oci_core_network_security_group.parse.id
    ai    = oci_core_network_security_group.ai.id
    index = oci_core_network_security_group.index.id
    app   = oci_core_network_security_group.app.id
  }
}
