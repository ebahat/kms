variable "compartment_id" { type = string }
variable "env" { type = string }
variable "app_subnet_id" { type = string }
variable "app_nsg_id" { type = string }

variable "redis_software_version" {
  description = "OCI Cache engine version — pin explicitly once a real tenancy shows the currently-supported values (`oci redis redis-cluster` doesn't expose a stable \"latest\" alias)"
  type        = string
  default     = "REDIS_7_0"
}
