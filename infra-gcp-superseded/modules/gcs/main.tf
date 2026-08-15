# Per-ADR-0006: one data bucket (per-tenant prefixes) + one WORM audit bucket.

resource "google_kms_key_ring" "storage" {
  name     = "kms-${var.env}-storage"
  location = var.region
}

resource "google_kms_crypto_key" "storage" {
  name     = "kms-${var.env}-storage-key"
  key_ring = google_kms_key_ring.storage.id
  rotation_period = "7776000s" # 90 days
}

resource "google_storage_bucket" "data" {
  name                        = "kms-${var.env}-data"
  location                    = var.region
  uniform_bucket_level_access = true
  encryption {
    default_kms_key_name = google_kms_crypto_key.storage.id
  }
  versioning { enabled = true }
  lifecycle_rule {
    condition { age = 7 } # artifacts backstop cleanup (ADR-0006)
    action    { type = "Delete" }
  }
}

resource "google_storage_bucket" "audit" {
  name                        = "kms-${var.env}-audit"
  location                    = var.region
  uniform_bucket_level_access = true
  encryption {
    default_kms_key_name = google_kms_crypto_key.storage.id
  }
  retention_policy {
    retention_period = 63072000 # 24 months, sec §12 item 7
    is_locked        = var.env == "prod"
  }
}

output "data_bucket" {
  value = google_storage_bucket.data.name
}

output "audit_bucket" {
  value = google_storage_bucket.audit.name
}
