import Redis from 'ioredis';
import { Provider } from '@nestjs/common';
import { SessionService } from '@kms/auth';
import { PermissionCache } from '@kms/permissions';
import { SESSION_SERVICE } from './auth/session-auth.guard';

export const REDIS_APP_CLIENT = 'REDIS_APP_CLIENT' as const;
export const PERMISSION_CACHE = 'PERMISSION_CACHE' as const;

/** Connects to redis-app (ADR-0007) — never redis-queue; kept as separate providers on purpose. */
export const redisAppProvider: Provider = {
  provide: REDIS_APP_CLIENT,
  useFactory: () => new Redis(process.env.REDIS_APP_HOST ?? 'localhost', { lazyConnect: true }),
};

export const sessionServiceProvider: Provider = {
  provide: SESSION_SERVICE,
  useFactory: (redis: Redis) => new SessionService(redis),
  inject: [REDIS_APP_CLIENT],
};

/** ADR-0005 Option C's versioned permission cache — same redis-app instance as sessions. */
export const permissionCacheProvider: Provider = {
  provide: PERMISSION_CACHE,
  useFactory: (redis: Redis) => new PermissionCache(redis),
  inject: [REDIS_APP_CLIENT],
};
