import RedisMock from 'ioredis-mock';
import { RateLimiter } from './rate-limiter';

describe('RateLimiter (backs TOTP 5/5min + login hardening thresholds)', () => {
  let redis: InstanceType<typeof RedisMock>;
  let limiter: RateLimiter;

  beforeEach(async () => {
    redis = new RedisMock();
    await redis.flushall(); // ioredis-mock instances share a default in-memory store unless flushed
    limiter = new RateLimiter(redis as any);
  });

  it('starts at 1 on the first increment and counts up from there', async () => {
    expect(await limiter.increment('k', 300)).toBe(1);
    expect(await limiter.increment('k', 300)).toBe(2);
    expect(await limiter.increment('k', 300)).toBe(3);
  });

  it('count() reflects the current value without incrementing', async () => {
    await limiter.increment('k', 300);
    await limiter.increment('k', 300);
    expect(await limiter.count('k')).toBe(2);
    expect(await limiter.count('k')).toBe(2); // idempotent read
  });

  it('count() is 0 for a key never touched', async () => {
    expect(await limiter.count('never-touched')).toBe(0);
  });

  it('reset() clears the counter', async () => {
    await limiter.increment('k', 300);
    await limiter.reset('k');
    expect(await limiter.count('k')).toBe(0);
  });

  it('keeps independent keys separate', async () => {
    await limiter.increment('login:a@b.com', 300);
    await limiter.increment('login:a@b.com', 300);
    await limiter.increment('totp:a@b.com', 300);
    expect(await limiter.count('login:a@b.com')).toBe(2);
    expect(await limiter.count('totp:a@b.com')).toBe(1);
  });
});
