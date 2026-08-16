variable "compartment_id" { type = string }
variable "env" { type = string }

variable "ssh_ingress_cidr" {
  description = "CIDR allowed to reach port 22. No default — set it explicitly (e.g. \"203.0.113.4/32\"). Do not use 0.0.0.0/0."
  type        = string
}
