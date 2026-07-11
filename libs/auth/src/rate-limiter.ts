import type { Redis } from 'ioredis';

/**
 * Fixed-window counter on redis-app (ADR-0007). Backs TOTP's 5/5min limit
 * (sec §2) and login hardening's progressive delay/lockout/CAPTCHA
 * thresholds (ADR-0004) — same primitive, different key prefixes and limits.
 */
export class RateLimiter {
  constructor(private readonly redis: Redis) {}

  /** Increments the window counter and returns the new count (1 on first hit in a fresh window). */
  async increment(key: string, windowSeconds: number): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, windowSeconds);
    return count;
  }

  async count(key: string): Promise<number> {
    const raw = await this.redis.get(key);
    return raw ? Number(raw) : 0;
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
