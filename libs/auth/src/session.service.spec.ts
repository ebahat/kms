import RedisMock from 'ioredis-mock';
import { SessionService } from './session.service';
import { SessionRecord } from './session';

describe('SessionService (ADR-0004, redis-app)', () => {
  let redis: InstanceType<typeof RedisMock>;
  let service: SessionService;

  const baseRecord: Omit<SessionRecord, 'createdAt' | 'lastSeenAt'> = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    role: 'user',
    edition: 'kb',
    mfaVerified: true,
  };

  beforeEach(() => {
    redis = new RedisMock();
    service = new SessionService(redis as any);
  });

  it('creates and retrieves a session', async () => {
    const id = await service.create('tenant', baseRecord);
    const record = await service.get('tenant', id);
    expect(record?.userId).toBe('user-1');
  });

  it('returns null for a missing session', async () => {
    const record = await service.get('tenant', 'nonexistent');
    expect(record).toBeNull();
  });

  it('revokes a single session', async () => {
    const id = await service.create('tenant', baseRecord);
    await service.revoke('tenant', id, baseRecord.userId);
    expect(await service.get('tenant', id)).toBeNull();
  });

  it('mass-revokes all sessions for a user (deactivation/password change)', async () => {
    const id1 = await service.create('tenant', baseRecord);
    const id2 = await service.create('tenant', baseRecord);
    await service.revokeAll('tenant', baseRecord.userId);
    expect(await service.get('tenant', id1)).toBeNull();
    expect(await service.get('tenant', id2)).toBeNull();
  });

  it('rotates a session id, invalidating the old one', async () => {
    const oldId = await service.create('tenant', baseRecord);
    const record = await service.get('tenant', oldId);
    const newId = await service.rotate('tenant', oldId, record!);
    expect(await service.get('tenant', oldId)).toBeNull();
    expect(await service.get('tenant', newId)).not.toBeNull();
  });

  it('keeps tenant and platform realms in separate keyspaces', async () => {
    const tenantId = await service.create('tenant', baseRecord);
    const platformRecord: Omit<SessionRecord, 'createdAt' | 'lastSeenAt'> = {
      userId: 'user-1',
      role: 'admin',
      mfaVerified: true,
    };
    await service.create('platform', platformRecord);
    // Same raw session id string would not collide across realms since the key is prefixed.
    expect(await service.get('platform', tenantId)).toBeNull();
  });
});
