variable "compartment_id" { type = string }
variable "namespace" { type = string }
variable "env" { type = string }
variable "kms_key_id" { type = string }

variable "retention_lock_date" {
  description = "RFC 3339 timestamp to lock the audit bucket's retention rule — only used when env == \"prod\". Locking is irreversible for the rule's duration, so this is deliberately not defaulted."
  type        = string
  default     = null
}
