variable "project_id" { type = string }
variable "region" { type = string }
variable "env" { type = string }
variable "domain" { type = string }
variable "network_id" { type = string }
variable "subnets" {
  type = object({
    parse = string
    ai    = string
    index = string
  })
}
variable "redis_app_host" { type = string }
variable "redis_queue_host" { type = string }
