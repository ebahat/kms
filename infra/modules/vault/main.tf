# OCI Vault covers both roles infra-gcp-superseded split into two GCP services: the KMS keyring
# (field-level envelope encryption for TOTP secrets/backup codes, ADR-0004/ADR-0014) and Secret
# Manager (app secrets). One vault, two keys, mirroring the GCP module's two-keyring intent
# (storage encryption key lives in the object-storage module instead, referencing this vault's id).

resource "oci_kms_vault" "app" {
  compartment_id = var.compartment_id
  display_name   = "kms-${var.env}-vault"
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

resource "oci_vault_secret" "argon2_pepper" {
  compartment_id = var.compartment_id
  vault_id       = oci_kms_vault.app.id
  key_id         = oci_kms_key.totp_envelope.id
  secret_name    = "kms-${var.env}-argon2-pepper"
  # No secret_content block — the value is written out-of-band (console/CLI) after creation, not
  # committed to Terraform state in plaintext. Matches the GCP module's own approach (an empty
  # `google_secret_manager_secret` shell, value added later).
  # UNVERIFIED, flag for Task 8: unlike GCP Secret Manager, it's not confirmed here whether OCI
  # Vault actually allows creating a secret with zero content/versions — `secret_content` may turn
  # out to be effectively required at apply time. If so, seed it with a throwaway placeholder value
  # and rotate immediately after the real pepper is generated, rather than leaving this assumption
  # unresolved past the first real `terraform plan`.
}

resource "oci_vault_secret" "provider_api_keys" {
  for_each        = toset(["vertex", "anthropic-fallback", "cohere-fallback", "openai-fallback"])
  compartment_id  = var.compartment_id
  vault_id        = oci_kms_vault.app.id
  key_id          = oci_kms_key.totp_envelope.id
  secret_name     = "kms-${var.env}-provider-${each.key}"
}

output "storage_key_id" {
  value = oci_kms_key.storage_encryption.id
}

output "vault_id" {
  value = oci_kms_vault.app.id
}
