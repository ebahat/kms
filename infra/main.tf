provider "google" {
  project = var.project_id
  region  = var.region
}

module "network" {
  source  = "./modules/network"
  project_id = var.project_id
  region     = var.region
  env        = var.env
}

module "redis" {
  source     = "./modules/redis"
  project_id = var.project_id
  region     = var.region
  env        = var.env
  network_id = module.network.network_id
}

module "gcs" {
  source     = "./modules/gcs"
  project_id = var.project_id
  region     = var.region
  env        = var.env
}

module "secrets" {
  source     = "./modules/secrets"
  project_id = var.project_id
  env        = var.env
}

module "cloud_run" {
  source        = "./modules/cloud-run"
  project_id    = var.project_id
  region        = var.region
  env           = var.env
  domain        = var.domain
  network_id    = module.network.network_id
  subnets       = module.network.subnets
  redis_app_host   = module.redis.app_host
  redis_queue_host = module.redis.queue_host
}
