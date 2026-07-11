import type { Redis } from 'ioredis';
import { randomBytes } from 'crypto';
import { Realm, REALM_CLOCKS, SessionRecord, sessionKey, userSessionIndexKey } from './session';

/**
 * Sessions on redis-app (ADR-0007) — the dedicated instance isolated from
 * BullMQ's redis-queue, so ingestion load can never evict a login (design
 * review 2026-07-10, finding 1). One instance, two realms distinguished by
 * key prefix (ADR-0004).
 */
export class SessionService {
  constructor(private readonly redis: Redis) {}

  async create(realm: Realm, record: Omit<SessionRecord, 'createdAt' | 'lastSeenAt'>): Promise<string> {
    const sessionId = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const full: SessionRecord = { ...record, createdAt: now, lastSeenAt: now };
    const { idleMs } = REALM_CLOCKS[realm];

    await this.redis
      .multi()
      .set(sessionKey(realm, sessionId), JSON.stringify(full), 'PX', idleMs)
      .sadd(userSessionIndexKey(realm, record.userId), sessionId)
      .exec();

    return sessionId;
  }

  /** Returns null if missing, expired (idle), or past the absolute lifetime. */
  async get(realm: Realm, sessionId: string): Promise<SessionRecord | null> {
    const raw = await this.redis.get(sessionKey(realm, sessionId));
    if (!raw) return null;

    const record: SessionRecord = JSON.parse(raw);
    const { absoluteMs } = REALM_CLOCKS[realm];
    const age = Date.now() - new Date(record.createdAt).getTime();
    if (age > absoluteMs) {
      await this.revoke(realm, sessionId, record.userId);
      return null;
    }
    return record;
  }

  /** Refreshes the idle-window TTL; call on every authenticated request. */
  async touch(realm: Realm, sessionId: string, record: SessionRecord): Promise<void> {
    const { idleMs } = REALM_CLOCKS[realm];
    const updated: SessionRecord = { ...record, lastSeenAt: new Date().toISOString() };
    await this.redis.set(sessionKey(realm, sessionId), JSON.stringify(updated), 'PX', idleMs);
  }

  async revoke(realm: Realm, sessionId: string, userId: string): Promise<void> {
    await this.redis
      .multi()
      .del(sessionKey(realm, sessionId))
      .srem(userSessionIndexKey(realm, userId), sessionId)
      .exec();
  }

  /** Mass revocation: deactivation, password change (PRD §6; sec §2). */
  async revokeAll(realm: Realm, userId: string): Promise<void> {
    const ids = await this.redis.smembers(userSessionIndexKey(realm, userId));
    if (ids.length === 0) return;
    const pipeline = this.redis.multi();
    for (const id of ids) pipeline.del(sessionKey(realm, id));
    pipeline.del(userSessionIndexKey(realm, userId));
    await pipeline.exec();
  }

  /** New session id on login / privilege change; old one deleted atomically (sec §2 rotation). */
  async rotate(realm: Realm, oldSessionId: string, record: SessionRecord): Promise<string> {
    const newId = await this.create(realm, record);
    await this.revoke(realm, oldSessionId, record.userId);
    return newId;
  }
}
