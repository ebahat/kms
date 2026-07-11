# VPC + per-pool subnets with mutually exclusive egress postures (ADR-0003, ADR-0007).

resource "google_compute_network" "vpc" {
  name                    = "kms-${var.env}-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "snet_parse" {
  name          = "snet-parse"
  ip_cidr_range = "10.10.1.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
}

resource "google_compute_subnetwork" "snet_ai" {
  name          = "snet-ai"
  ip_cidr_range = "10.10.2.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
}

resource "google_compute_subnetwork" "snet_index" {
  name          = "snet-index"
  ip_cidr_range = "10.10.3.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
}

# snet-parse: NO internet egress. Only clamd (in-VPC), GCS, Memorystore, Atlas PSC (sec §4.4).
resource "google_compute_firewall" "parse_deny_internet_egress" {
  name      = "kms-${var.env}-parse-deny-internet"
  network   = google_compute_network.vpc.id
  direction = "EGRESS"
  priority  = 1000
  deny { protocol = "all" }
  destination_ranges = ["0.0.0.0/0"]
  target_tags        = ["worker-parse"]
}

resource "google_compute_firewall" "parse_allow_internal" {
  name      = "kms-${var.env}-parse-allow-internal"
  network   = google_compute_network.vpc.id
  direction = "EGRESS"
  priority  = 900
  allow { protocol = "all" }
  destination_ranges = [google_compute_subnetwork.snet_parse.ip_cidr_range]
  target_tags        = ["worker-parse"]
}

# snet-ai: named AI/OCR endpoints only (sec §5.6) — exact CIDRs/FQDNs pinned in ADR-0008 follow-up.
resource "google_compute_firewall" "ai_allow_named_egress" {
  name      = "kms-${var.env}-ai-allow-named"
  network   = google_compute_network.vpc.id
  direction = "EGRESS"
  priority  = 1000
  allow { protocol = "tcp", ports = ["443"] }
  # Placeholder — replace with Vertex AI / Google Vision / Azure OCR endpoint ranges (ADR-0008).
  destination_ranges = ["199.36.153.8/30"] # private.googleapis.com VIP range
  target_tags        = ["worker-ai"]
}

# snet-index: Atlas PSC + GCS + Memorystore only.
resource "google_compute_firewall" "index_allow_atlas_gcs" {
  name      = "kms-${var.env}-index-allow-atlas-gcs"
  network   = google_compute_network.vpc.id
  direction = "EGRESS"
  priority  = 1000
  allow { protocol = "tcp", ports = ["443", "27017"] }
  destination_ranges = ["199.36.153.8/30"]
  target_tags        = ["worker-index"]
}

output "network_id" {
  value = google_compute_network.vpc.id
}

output "subnets" {
  value = {
    parse = google_compute_subnetwork.snet_parse.id
    ai    = google_compute_subnetwork.snet_ai.id
    index = google_compute_subnetwork.snet_index.id
  }
}
