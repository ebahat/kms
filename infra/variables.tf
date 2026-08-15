variable "compartment_id" {
  description = "OCID of the compartment to provision into (ADR-0014: single environment for now, no prod/staging split — see the plan's scoping decisions)"
  type        = string
}

variable "region" {
  description = "OCI region — eu-frankfurt-1 (PRD §3 EU residency; ADR-0014 scoping decision)"
  type        = string
  default     = "eu-frankfurt-1"
}

variable "env" {
  description = "Environment name, used in resource naming. Single environment for now (ADR-0014 scoping) — defaults to \"kms\", not \"prod\", since there's no staging counterpart yet to disambiguate from."
  type        = string
  default     = "kms"
}

variable "domain" {
  description = "Base domain; api.<domain>, admin.<domain>, app.<domain> are derived (mirrors ADR-0007's convention)"
  type        = string
}

variable "object_storage_namespace" {
  description = "Tenancy's Object Storage namespace — find it with `oci os ns get` (see docs/deployment/gcp-aws-deployment-guide-11-08-2026.md's OCI section). Not derivable from other inputs without a live API call, so it's a plain input rather than a data source lookup at plan time."
  type        = string
}
