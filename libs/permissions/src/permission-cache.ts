import type { Redis } from 'ioredis';
import { computeFolderWidening, resolveFolderPermissions } from './resolve-permissions';
import { DecidingGrant, FolderInput, FolderPermissionResolution, FolderWideningInfo, PrincipalSet } from './types';

/**
 * Defensive-only: `permVersion` keys are never explicitly deleted (the whole
 * point is that old-version keys become unreachable, not that they get
 * cleaned up), so without a TTL they'd accumulate in Redis for the life of
 * the deployment. Not mandated by ADR-0005 — a hygiene safety net, since
 * version-keyed cache correctness never depends on this TTL firing.
 */
const CACHE_TTL_SECONDS = 24 * 60 * 60;

function permVersionKey(tenantId: string): string {
  return `perm:version:${tenantId}`;
}

function resolutionKey(tenantId: string, userId: string, version: number): string {
  return `perm:resolution:${tenantId}:${userId}:${version}`;
}

function wideningKey(tenantId: string, version: number): string {
  return `perm:widening:${tenantId}:${version}`;
}

type SerializedResolution = {
  permittedRead: string[];
  permittedEdit: string[];
  permittedManage: string[];
  decidingGrant: [string, DecidingGrant][];
};

/**
 * Redis-app (ADR-0007, same instance as sessions) wrapper for ADR-0005 Option
 * C: a versioned cache keyed `{tenantId, userId, permVersion}`. Every method
 * here does the raw Redis op and lets errors propagate — callers decide
 * fallback behavior (see resolveFolderPermissionsCached/
 * computeFolderWideningCached below for the composed, fallback-aware form the
 * ADR calls for: "Redis outage degrades to per-request recomputation — the
 * service must implement that fallback, not fail").
 */
export class PermissionCache {
  constructor(private readonly redis: Redis) {}

  async getVersion(tenantId: string): Promise<number> {
    const raw = await this.redis.get(permVersionKey(tenantId));
    return raw ? Number(raw) : 0;
  }

  /** Synchronous, atomic per-tenant counter bump. Callers invoke this in the same operation as any grant/group/folder-move/public-flag write (ADR-0005). */
  async bumpVersion(tenantId: string): Promise<number> {
    return this.redis.incr(permVersionKey(tenantId));
  }

  async getResolution(tenantId: string, userId: string, version: number): Promise<FolderPermissionResolution | null> {
    const raw = await this.redis.get(resolutionKey(tenantId, userId, version));
    if (!raw) return null;
    const parsed: SerializedResolution = JSON.parse(raw);
    return { ...parsed, decidingGrant: new Map(parsed.decidingGrant) };
  }

  async setResolution(tenantId: string, userId: string, version: number, resolution: FolderPermissionResolution): Promise<void> {
    const serialized: SerializedResolution = { ...resolution, decidingGrant: [...resolution.decidingGrant.entries()] };
    await this.redis.set(resolutionKey(tenantId, userId, version), JSON.stringify(serialized), 'EX', CACHE_TTL_SECONDS);
  }

  async getWidening(tenantId: string, version: number): Promise<Map<string, FolderWideningInfo> | null> {
    const raw = await this.redis.get(wideningKey(tenantId, version));
    if (!raw) return null;
    const parsed: [string, FolderWideningInfo][] = JSON.parse(raw);
    return new Map(parsed);
  }

  async setWidening(tenantId: string, version: number, widening: Map<string, FolderWideningInfo>): Promise<void> {
    await this.redis.set(wideningKey(tenantId, version), JSON.stringify([...widening.entries()]), 'EX', CACHE_TTL_SECONDS);
  }
}

/**
 * The get-or-compute-and-cache flow Option C actually calls for. Any Redis
 * failure (miss is not a failure) falls back to computing directly from
 * `folders`/`principals` — never throws for the caller's sake, matching "the
 * service must implement that fallback, not fail." The re-cache write is
 * best-effort: a failed write here must not fail the request that triggered it.
 */
export async function resolveFolderPermissionsCached(
  cache: PermissionCache,
  tenantId: string,
  folders: FolderInput[],
  principals: PrincipalSet,
): Promise<FolderPermissionResolution> {
  let version = 0;
  try {
    version = await cache.getVersion(tenantId);
    const cached = await cache.getResolution(tenantId, principals.userId, version);
    if (cached) return cached;
  } catch {
    // Redis unreachable — fall through to direct computation (ADR-0005 accepted risk).
  }

  const resolution = resolveFolderPermissions(folders, principals);
  try {
    await cache.setResolution(tenantId, principals.userId, version, resolution);
  } catch {
    // Best-effort: a cache-write failure must not fail the request.
  }
  return resolution;
}

/** Same fallback discipline as resolveFolderPermissionsCached, for the viewer-independent widening metadata. */
export async function computeFolderWideningCached(
  cache: PermissionCache,
  tenantId: string,
  folders: FolderInput[],
): Promise<Map<string, FolderWideningInfo>> {
  let version = 0;
  try {
    version = await cache.getVersion(tenantId);
    const cached = await cache.getWidening(tenantId, version);
    if (cached) return cached;
  } catch {
    // Redis unreachable — fall through to direct computation.
  }

  const widening = computeFolderWidening(folders);
  try {
    await cache.setWidening(tenantId, version, widening);
  } catch {
    // Best-effort.
  }
  return widening;
}
