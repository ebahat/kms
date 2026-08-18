variable "compartment_id" { type = string }
variable "env" { type = string }
variable "region" { type = string }
# Temporary escape hatch: the canonical "kms-<env>-vault" name may collide with a vault that's
# still winding down a cancelled Pending Deletion. Set to e.g. "-v2" to create under a distinct
# name, then rename back in the console once the old one's status settles.
variable "name_suffix" {
  type    = string
  default = ""
}
