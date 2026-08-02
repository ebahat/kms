import RedisMock from 'ioredis-mock';
import { computeFolderWideningCached, PermissionCache, resolveFolderPermissionsCached } from './permission-cache';
import { FolderInput, FolderPermissionResolution } from './types';

describe('PermissionCache (ADR-0005 Option C, redis-app)', () => {
  let redis: InstanceType<typeof RedisMock>;
  let cache: PermissionCache;

  beforeEach(async () => {
    // ioredis-mock instances share one global in-memory store by default (mirroring
    // multiple clients on the same real server) — flush explicitly for test isolation.
    redis = new RedisMock();
    await redis.flushall();
    cache = new PermissionCache(redis as any);
  });

  it('returns version 0 before any bump', async () => {
    expect(await cache.getVersion('tenant-1')).toBe(0);
  });

  it('bumpVersion increments atomically and getVersion reflects it', async () => {
    expect(await cache.bumpVersion('tenant-1')).toBe(1);
    expect(await cache.bumpVersion('tenant-1')).toBe(2);
    expect(await cache.getVersion('tenant-1')).toBe(2);
  });

  it('versions are isolated per tenant', async () => {
    await cache.bumpVersion('tenant-1');
    expect(await cache.getVersion('tenant-2')).toBe(0);
  });

  it('round-trips a resolution including the decidingGrant Map', async () => {
    const resolution: FolderPermissionResolution = {
      permittedRead: ['f1'],
      permittedEdit: [],
      permittedManage: [],
      decidingGrant: new Map([['f1', { tier: 'read', via: 'public' }]]),
    };
    await cache.setResolution('tenant-1', 'user-1', 0, resolution);
    const got = await cache.getResolution('tenant-1', 'user-1', 0);
    expect(got).toEqual(resolution);
    expect(got?.decidingGrant).toBeInstanceOf(Map);
  });

  it('getResolution misses for a version that was never cached', async () => {
    expect(await cache.getResolution('tenant-1', 'user-1', 5)).toBeNull();
  });

  it('resolutions are isolated per user within the same tenant/version', async () => {
    const resolution: FolderPermissionResolution = {
      permittedRead: ['f1'],
      permittedEdit: [],
      permittedManage: [],
      decidingGrant: new Map(),
    };
    await cache.setResolution('tenant-1', 'user-1', 0, resolution);
    expect(await cache.getResolution('tenant-1', 'user-2', 0)).toBeNull();
  });

  it('round-trips widening metadata', async () => {
    const widening = new Map([['f1', { broaderThanParent: true, addedGroups: ['g1'], becamePublic: false }]]);
    await cache.setWidening('tenant-1', 0, widening);
    expect(await cache.getWidening('tenant-1', 0)).toEqual(widening);
  });
});

describe('resolveFolderPermissionsCached (get-or-compute-and-cache)', () => {
  let redis: InstanceType<typeof RedisMock>;
  let cache: PermissionCache;
  const folders: FolderInput[] = [{ id: 'f1', parentId: null, grants: [], hasExplicitGrants: true, isPublic: true }];
  const principals = { userId: 'user-1', groupIds: [] };

  beforeEach(async () => {
    // ioredis-mock instances share one global in-memory store by default (mirroring
    // multiple clients on the same real server) — flush explicitly for test isolation.
    redis = new RedisMock();
    await redis.flushall();
    cache = new PermissionCache(redis as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('computes on a cache miss and returns the correct resolution', async () => {
    const result = await resolveFolderPermissionsCached(cache, 'tenant-1', folders, principals);
    expect(result.permittedRead).toEqual(['f1']);
  });

  it('caches the result: a second call ignores a changed input and returns the stale cached value', async () => {
    const changedFolders: FolderInput[] = [{ ...folders[0], isPublic: false }]; // would resolve to permittedRead: [] if recomputed
    await resolveFolderPermissionsCached(cache, 'tenant-1', folders, principals);
    const second = await resolveFolderPermissionsCached(cache, 'tenant-1', changedFolders, principals);
    expect(second.permittedRead).toEqual(['f1']); // proves the cached value was served, not a recompute over changedFolders
  });

  it('a version bump invalidates the cached entry and forces recomputation', async () => {
    const changedFolders: FolderInput[] = [{ ...folders[0], isPublic: false }];
    await resolveFolderPermissionsCached(cache, 'tenant-1', folders, principals);
    await cache.bumpVersion('tenant-1');
    const afterBump = await resolveFolderPermissionsCached(cache, 'tenant-1', changedFolders, principals);
    expect(afterBump.permittedRead).toEqual([]); // proves recomputation actually ran over changedFolders
  });

  it('falls back to direct computation if Redis reads throw (outage), and still succeeds', async () => {
    jest.spyOn(cache, 'getVersion').mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await resolveFolderPermissionsCached(cache, 'tenant-1', folders, principals);
    expect(result.permittedRead).toEqual(['f1']);
  });

  it('a failed cache write does not fail the request', async () => {
    jest.spyOn(cache, 'setResolution').mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await resolveFolderPermissionsCached(cache, 'tenant-1', folders, principals);
    expect(result.permittedRead).toEqual(['f1']);
  });
});

describe('computeFolderWideningCached', () => {
  let redis: InstanceType<typeof RedisMock>;
  let cache: PermissionCache;
  const folders: FolderInput[] = [{ id: 'f1', parentId: null, grants: [], hasExplicitGrants: true, isPublic: true }];
  // Non-root pair whose widening flag actually depends on the input, for the cache-hit-ignores-changed-input test below.
  const parentAndChild: FolderInput[] = [
    { id: 'p1', parentId: null, grants: [{ principalType: 'group', principalId: 'g-a', access: 'read' }], hasExplicitGrants: true, isPublic: false },
    {
      id: 'c1',
      parentId: 'p1',
      grants: [
        { principalType: 'group', principalId: 'g-a', access: 'read' },
        { principalType: 'group', principalId: 'g-b', access: 'read' },
      ],
      hasExplicitGrants: true,
      isPublic: false,
    },
  ];
  const narrowedChild: FolderInput[] = [
    parentAndChild[0],
    { ...parentAndChild[1], grants: [{ principalType: 'group', principalId: 'g-a', access: 'read' }] }, // no longer broader
  ];

  beforeEach(async () => {
    // ioredis-mock instances share one global in-memory store by default (mirroring
    // multiple clients on the same real server) — flush explicitly for test isolation.
    redis = new RedisMock();
    await redis.flushall();
    cache = new PermissionCache(redis as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('computes on a cache miss', async () => {
    const result = await computeFolderWideningCached(cache, 'tenant-1', folders);
    expect(result.get('f1')?.broaderThanParent).toBe(false);
  });

  it('caches: a second call ignores a changed input and returns the stale cached value', async () => {
    await computeFolderWideningCached(cache, 'tenant-1', parentAndChild);
    const second = await computeFolderWideningCached(cache, 'tenant-1', narrowedChild);
    expect(second.get('c1')?.broaderThanParent).toBe(true); // proves the cached value was served, not a recompute
  });

  it('a version bump invalidates the cached entry and forces recomputation', async () => {
    await computeFolderWideningCached(cache, 'tenant-1', parentAndChild);
    await cache.bumpVersion('tenant-1');
    const afterBump = await computeFolderWideningCached(cache, 'tenant-1', narrowedChild);
    expect(afterBump.get('c1')?.broaderThanParent).toBe(false); // proves recomputation actually ran over narrowedChild
  });

  it('falls back to direct computation on a Redis outage', async () => {
    jest.spyOn(cache, 'getVersion').mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await computeFolderWideningCached(cache, 'tenant-1', folders);
    expect(result.get('f1')?.broaderThanParent).toBe(false);
  });
});
