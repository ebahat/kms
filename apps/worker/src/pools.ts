/**
 * One image, three deployments (ADR-0003/0009). WORKER_POOL selects which
 * queues this process consumes; the sandbox distinction is infrastructure
 * (subnet + firewall + service account, ADR-0007), not build flavor.
 * Boot-time assertion below is the mitigation for "mis-set env var runs the
 * wrong processor" (ADR-0009 consequences).
 */
export const WORKER_POOLS = ['parse', 'ai', 'index'] as const;
export type WorkerPool = (typeof WORKER_POOLS)[number];

export const POOL_QUEUES: Record<WorkerPool, string[]> = {
  parse: ['scan', 'parse'],
  ai: ['ocr-classic', 'ocr-advanced', 'chunk', 'embed'],
  index: ['index'],
};

export function resolveWorkerPool(env: NodeJS.ProcessEnv = process.env): WorkerPool {
  const pool = env.WORKER_POOL;
  if (!pool || !WORKER_POOLS.includes(pool as WorkerPool)) {
    throw new Error(
      `WORKER_POOL must be one of ${WORKER_POOLS.join(', ')} — got "${pool}"`,
    );
  }
  return pool as WorkerPool;
}
