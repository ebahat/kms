# Per-ADR-0006 (rebound by ADR-0014): one data bucket (per-tenant prefixes, app-owned versioning) +
# one WORM audit bucket. OCI Object Storage's retention rules are inline on the bucket resource
# (unlike GCS's separate retention_policy block, functionally equivalent).

resource "oci_objectstorage_bucket" "data" {
  compartment_id = var.compartment_id
  namespace      = var.namespace
  name           = "kms-${var.env}-data"
  kms_key_id     = var.kms_key_id
  # Deliberately NOT setting `versioning = "Enabled"` here: ADR-0006's decision table explicitly says
  # "versioning off (the app owns versioning per PRD §8)" — documentVersions records are how this app
  # tracks versions, not bucket-level object versioning. Found while porting this module that
  # infra-gcp-superseded's own GCS resource actually set `versioning { enabled = true }`, contradicting
  # its own ADR — a pre-existing inconsistency in the never-applied GCP skeleton, not something to
  # carry forward. Left as `Disabled` (the resource's own default) here, matching the ADR.
  object_events_enabled = true
}

resource "oci_objectstorage_bucket" "audit" {
  compartment_id = var.compartment_id
  namespace      = var.namespace
  name           = "kms-${var.env}-audit"
  kms_key_id     = var.kms_key_id

  # WORM/retention — sec §12 item 7, 24 months. `time_rule_locked` set only in the real prod
  # environment (mirrors the GCS module's `is_locked = var.env == "prod"` gate) — locking a rule
  # before that is irreversible for its duration, so it's deliberately not locked by default here.
  # A fixed var (not `timestamp()`, which would make every plan show a diff) — must be supplied
  # explicitly when var.env == "prod", left null otherwise.
  retention_rules {
    display_name = "audit-retention-24mo"
    duration {
      time_amount = 24
      time_unit   = "MONTHS"
    }
    time_rule_locked = var.env == "prod" ? var.retention_lock_date : null
  }
}

output "data_bucket" {
  value = oci_objectstorage_bucket.data.name
}

output "audit_bucket" {
  value = oci_objectstorage_bucket.audit.name
}
