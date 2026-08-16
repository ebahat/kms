variable "compartment_id" {
  description = "OCID of the compartment to provision into"
  type        = string
}

variable "region" {
  description = "OCI region — eu-frankfurt-1 (PRD §3 EU residency). Must be the tenancy's HOME region: Always Free resources are only free in the home region."
  type        = string
  default     = "eu-frankfurt-1"
}

variable "env" {
  description = "Environment name, used in resource naming. Single environment (ADR-0015)."
  type        = string
  default     = "kms"
}

variable "domain" {
  description = "Base domain; api.<domain>, admin.<domain>, app.<domain> are served by Caddy on the VM. Unlike the managed topology, this IS used for real — Caddy routes on it and obtains Let's Encrypt certs for it. DNS must point at the VM's public IP before deploying."
  type        = string
}

variable "object_storage_namespace" {
  description = "Tenancy's Object Storage namespace — `oci os ns get`"
  type        = string
}

variable "ssh_public_key" {
  description = "Public key for the VM's `opc` user (contents of e.g. ~/.ssh/id_ed25519.pub)"
  type        = string
}

variable "ssh_ingress_cidr" {
  description = "CIDR allowed to SSH to the VM. No default by design — set to your own address (e.g. \"203.0.113.4/32\"), not 0.0.0.0/0."
  type        = string
}
