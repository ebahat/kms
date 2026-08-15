variable "project_id" {
  description = "GCP project id (kms-staging or kms-prod — sec §10 full environment separation)"
  type        = string
}

variable "region" {
  description = "GCP region — europe-west (PRD §3 EU residency)"
  type        = string
  default     = "europe-west4"
}

variable "env" {
  description = "Environment name, used in resource naming (staging|prod)"
  type        = string
}

variable "domain" {
  description = "Base domain; api.<domain>, admin.<domain>, app.<domain> are derived"
  type        = string
}
