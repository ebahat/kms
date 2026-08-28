import { z } from 'zod';

/**
 * Typed env loading. Grows as each app/worker pool needs new config;
 * kept centralized so a missing/malformed env var fails fast at boot
 * rather than surfacing as a runtime data-path bug.
 */
const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

export function loadBaseEnv(env: NodeJS.ProcessEnv = process.env): BaseEnv {
  return baseEnvSchema.parse(env);
}

/**
 * `apps/worker`'s BullMQ connection (ADR-0003) — a separate Redis instance
 * from `redis-app` (sessions/permission-cache), matching `apps/api`'s own
 * `REDIS_APP_HOST` naming convention. `deploy/docker-compose.yml` already
 * declares `REDIS_QUEUE_HOST: redis-queue` for the `api` producer side (it
 * predates this schema — the env var name was already anticipated).
 */
const queueEnvSchema = z.object({
  REDIS_QUEUE_HOST: z.string().default('localhost'),
});

export type QueueEnv = z.infer<typeof queueEnvSchema>;

export function loadQueueEnv(env: NodeJS.ProcessEnv = process.env): QueueEnv {
  return queueEnvSchema.parse(env);
}
