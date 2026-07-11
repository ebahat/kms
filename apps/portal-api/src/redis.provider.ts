import Redis from 'ioredis';
import { Provider } from '@nestjs/common';
import { SessionService } from '@kms/auth';
import { SESSION_SERVICE } from './auth/platform-session-auth.guard';

export const REDIS_APP_CLIENT = 'REDIS_APP_CLIENT' as const;

/** Same physical redis-app instance as apps/api (ADR-0007) — realm-prefixed keys keep the two session namespaces apart (ADR-0004). */
export const redisAppProvider: Provider = {
  provide: REDIS_APP_CLIENT,
  useFactory: () => new Redis(process.env.REDIS_APP_HOST ?? 'localhost', { lazyConnect: true }),
};

export const sessionServiceProvider: Provider = {
  provide: SESSION_SERVICE,
  useFactory: (redis: Redis) => new SessionService(redis),
  inject: [REDIS_APP_CLIENT],
};
