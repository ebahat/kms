variable "compartment_id" { type = string }
variable "region" { type = string }
variable "env" { type = string }
variable "vcn_id" { type = string }
variable "public_subnet_id" { type = string }
variable "app_subnet_id" { type = string }
variable "app_nsg_id" { type = string }
variable "subnets" {
  type = object({
    parse = string
    ai    = string
    index = string
  })
}
variable "nsgs" {
  type = object({
    parse = string
    ai    = string
    index = string
  })
}
variable "redis_app_host" { type = string }
variable "redis_queue_host" { type = string }

variable "ocir_namespace" {
  description = "Object Storage namespace, reused as the OCIR registry namespace (OCIR shares the tenancy's Object Storage namespace) — find it with `oci os ns get`"
  type        = string
}
