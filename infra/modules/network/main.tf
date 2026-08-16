# Minimal VCN for the single-VM pre-revenue topology (ADR-0015).
#
# Deliberately far simpler than infra-oci-managed/modules/network: one public subnet, no NAT gateway,
# no service gateway, no per-worker-pool subnets. The per-pool egress isolation that module
# implements (ADR-0003: parse = no internet, ai = named endpoints, index = Atlas only) exists to
# separate worker pools that **are not deployed here** — Phase 3 is deferred, so there is nothing to
# isolate. That isolation is not being weakened; it's not yet applicable. It returns with ADR-0014's
# topology when Phase 3 ships.
#
# NAT gateway is intentionally absent: the single VM sits in a public subnet with its own public IP,
# so it egresses via the internet gateway directly. Adding a NAT gateway would be cost-free on OCI
# but pointless here — nothing runs in a private subnet.

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

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.vcn.id
  display_name   = "kms-${var.env}-public-rt"
  route_rules {
    destination       = "0.0.0.0/0"
    network_entity_id = oci_core_internet_gateway.igw.id
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

resource "oci_core_network_security_group" "app" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.vcn.id
  display_name   = "kms-${var.env}-nsg-app"
}

# 80 is required, not optional: Caddy needs it for the Let's Encrypt HTTP-01 challenge. It redirects
# to 443 for all other traffic.
resource "oci_core_network_security_group_security_rule" "http_ingress" {
  network_security_group_id = oci_core_network_security_group.app.id
  direction                 = "INGRESS"
  protocol                  = "6" # TCP
  source                    = "0.0.0.0/0"
  source_type               = "CIDR_BLOCK"
  description               = "HTTP — Let's Encrypt HTTP-01 challenge + redirect to HTTPS"
  tcp_options {
    destination_port_range {
      min = 80
      max = 80
    }
  }
}

resource "oci_core_network_security_group_security_rule" "https_ingress" {
  network_security_group_id = oci_core_network_security_group.app.id
  direction                 = "INGRESS"
  protocol                  = "6" # TCP
  source                    = "0.0.0.0/0"
  source_type               = "CIDR_BLOCK"
  description               = "HTTPS — all application traffic (Caddy terminates TLS)"
  tcp_options {
    destination_port_range {
      min = 443
      max = 443
    }
  }
}

# SSH restricted to a caller-supplied CIDR, never 0.0.0.0/0 by default — an open SSH port on a public
# IP is the single most-scanned attack surface on the internet. var.ssh_ingress_cidr has no default,
# so this is a conscious decision at apply time, not something inherited silently.
resource "oci_core_network_security_group_security_rule" "ssh_ingress" {
  network_security_group_id = oci_core_network_security_group.app.id
  direction                 = "INGRESS"
  protocol                  = "6" # TCP
  source                    = var.ssh_ingress_cidr
  source_type               = "CIDR_BLOCK"
  description               = "SSH — restricted to the operator's own address range"
  tcp_options {
    destination_port_range {
      min = 22
      max = 22
    }
  }
}

# Egress: unrestricted. The VM must reach Atlas (27017), Let's Encrypt, OCIR, Object Storage, and OS
# package mirrors. Pinning these to named CIDRs is an ADR-0014-topology concern (per-pool NSGs) and
# would be security theatre on a single general-purpose VM that legitimately needs broad egress.
resource "oci_core_network_security_group_security_rule" "all_egress" {
  network_security_group_id = oci_core_network_security_group.app.id
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
  description               = "All egress — Atlas, Let's Encrypt, OCIR, Object Storage, OS updates"
}

output "subnet_id" {
  value = oci_core_subnet.public.id
}

output "nsg_id" {
  value = oci_core_network_security_group.app.id
}
