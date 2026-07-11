# Secret Manager entries + the KMS keyring for field-level crypto (ADR-0004/0007).

resource "google_kms_key_ring" "app" {
  name     = "kms-${var.env}-app"
  location = "global"
}

resource "google_kms_crypto_key" "totp_envelope" {
  name     = "totp-envelope-key"
  key_ring = google_kms_key_ring.app.id
  rotation_period = "31536000s" # annual (sec §6)
}

resource "google_secret_manager_secret" "argon2_pepper" {
  secret_id = "kms-${var.env}-argon2-pepper"
  replication { auto {} }
}

resource "google_secret_manager_secret" "provider_api_keys" {
  for_each  = toset(["vertex", "anthropic-fallback", "cohere-fallback", "openai-fallback"])
  secret_id = "kms-${var.env}-provider-${each.key}"
  replication { auto {} }
}
