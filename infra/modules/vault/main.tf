# OCI Vault covers both roles infra-gcp-superseded split into two GCP services: the KMS keyring
# (field-level envelope encryption for TOTP secrets/backup codes, ADR-0004/ADR-0014) and Secret
# Manager (app secrets). One vault, two keys, mirroring the GCP module's two-keyring intent
# (storage encryption key lives in the object-storage module instead, referencing this vault's id).

resource "oci_kms_vault" "app" {
  compartment_id = var.compartment_id
  display_name   = "kms-${var.env}-vault${var.name_suffix}"
  vault_type     = "DEFAULT"
}

resource "oci_kms_key" "totp_envelope" {
  compartment_id      = var.compartment_id
  display_name        = "kms-${var.env}-totp-envelope-key"
  management_endpoint = oci_kms_vault.app.management_endpoint
  key_shape {
    algorithm = "AES"
    length    = 32
  }
  # Annual rotation (sec §6) — OCI Vault keys don't auto-rotate on a schedule via this resource;
  # rotation is a Follow-up (scheduled key-version creation), same as noted for the storage key below.
}

resource "oci_kms_key" "storage_encryption" {
  compartment_id      = var.compartment_id
  display_name        = "kms-${var.env}-storage-key"
  management_endpoint = oci_kms_vault.app.management_endpoint
  key_shape {
    algorithm = "AES"
    length    = 32
  }
}

# Required for the object-storage module's buckets to use storage_encryption as their kms_key_id —
# Object Storage does not get Vault key access by default (CONFIRMED 2026-08-18: bucket creation
# fails 404-NotAuthorizedOrFoundKmsKey without this).
resource "oci_identity_policy" "object_storage_kms_access" {
  compartment_id = var.compartment_id
  name           = "kms-${var.env}-objectstorage-kms-access"
  description    = "Lets Object Storage use this compartment's Vault keys for bucket SSE-KMS encryption."
  statements = [
    "allow service objectstorage-${var.region} to use keys in compartment id ${var.compartment_id}"
  ]
}

resource "oci_vault_secret" "argon2_pepper" {
  compartment_id = var.compartment_id
  vault_id       = oci_kms_vault.app.id
  key_id         = oci_kms_key.totp_envelope.id
  secret_name    = "kms-${var.env}-argon2-pepper"
  # CONFIRMED (2026-08-18): OCI rejects CreateSecret with neither secret_content nor
  # enable_auto_generation ("Provide valid secret content or enable auto-generation") — the prior
  # UNVERIFIED note's worst case was real. Seeded with a throwaway placeholder; rotate immediately
  # after apply (console/CLI) to the real value, which is never committed to Terraform state in
  # plaintext beyond this placeholder. ignore_changes so that out-of-band rotation isn't reverted
  # back to the placeholder on the next apply.
  secret_content {
    content_type = "BASE64"
    content      = base64encode("placeholder-rotate-immediately-after-apply")
  }
  lifecycle {
    ignore_changes = [secret_content]
  }
}

resource "oci_vault_secret" "provider_api_keys" {
  for_each       = toset(["vertex", "anthropic-fallback", "cohere-fallback", "openai-fallback"])
  compartment_id = var.compartment_id
  vault_id       = oci_kms_vault.app.id
  key_id         = oci_kms_key.totp_envelope.id
  secret_name    = "kms-${var.env}-provider-${each.key}"
  secret_content {
    content_type = "BASE64"
    content      = base64encode("placeholder-rotate-immediately-after-apply")
  }
  lifecycle {
    ignore_changes = [secret_content]
  }
}

output "storage_key_id" {
  value = oci_kms_key.storage_encryption.id
}

output "vault_id" {
  value = oci_kms_vault.app.id
}
