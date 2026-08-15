# Two Memorystore instances with OPPOSITE eviction policies (design review 2026-07-10, finding 1).
# Splitting them is the fix: an ingestion burst on redis-queue must never evict redis-app sessions.

resource "google_redis_instance" "app" {
  name           = "kms-${var.env}-redis-app"
  tier           = "STANDARD_HA"
  memory_size_gb = 2
  region         = var.region
  authorized_network = var.network_id
  auth_enabled        = true
  transit_encryption_mode = "SERVER_AUTHENTICATION"
  redis_configs = {
    "maxmemory-policy" = "volatile-lru" # sessions/counters/perm-cache are eviction-tolerant (ADR-0004/0005)
  }
}

resource "google_redis_instance" "queue" {
  name           = "kms-${var.env}-redis-queue"
  tier           = "STANDARD_HA"
  memory_size_gb = 4
  region         = var.region
  authorized_network = var.network_id
  auth_enabled        = true
  transit_encryption_mode = "SERVER_AUTHENTICATION"
  redis_configs = {
    "maxmemory-policy" = "noeviction" # BullMQ must never lose jobs to eviction (ADR-0003)
  }
}

# Used-memory alert on redis-queue (design review finding 1; sec §8.3).
resource "google_monitoring_alert_policy" "redis_queue_memory" {
  display_name = "kms-${var.env}-redis-queue-memory-high"
  combiner     = "OR"
  conditions {
    display_name = "redis-queue memory usage > 80%"
    condition_threshold {
      filter          = "resource.type=\"redis_instance\" AND resource.labels.instance_id=\"${google_redis_instance.queue.id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "300s"
    }
  }
  notification_channels = [] # wired to the on-call channel at first deploy (ADR-0007 §8.3)
}

output "app_host" {
  value = google_redis_instance.app.host
}

output "queue_host" {
  value = google_redis_instance.queue.host
}
