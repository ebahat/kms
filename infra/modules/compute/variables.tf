variable "compartment_id" { type = string }
variable "env" { type = string }
variable "subnet_id" { type = string }
variable "nsg_id" { type = string }

variable "ssh_public_key" {
  description = "Public key for the `opc` user. Generate with `ssh-keygen -t ed25519`; paste the .pub contents."
  type        = string
}

variable "ocpus" {
  description = "OCPUs. 2 is the Always Free ceiling — above it, billing starts (guarded by a precondition in main.tf)."
  type        = number
  default     = 2
}

variable "memory_in_gbs" {
  description = "Memory in GB. 12 is the Always Free ceiling — above it, billing starts (guarded by a precondition in main.tf)."
  type        = number
  default     = 12
}
