import 'reflect-metadata';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import RedisMock from 'ioredis-mock';

/**
 * Real integration-test harness (Task 9). No live MongoDB/Redis dependency:
 * MongoMemoryServer boots a real (not mocked) mongod in-process, and
 * ioredis-mock stands in for redis-app — the same fake already used by
 * apps/api's own unit specs (auth.controller.spec.ts). Every guard
 * (SessionAuthGuard/MfaGateGuard/TosGateGuard/EditionGuard/ModuleGuard) and
 * every repository runs for real; only the two external processes this
 * sandbox can't provide are swapped for in-process equivalents.
 *
 * `AppModule` reads `process.env.MONGO_URI` at class-definition time (its
 * `MongooseModule.forRoot(...)` call), so it's imported dynamically here
 * *after* the env var is set — a static top-level import would evaluate
 * too early. Jest gives every test file its own fresh module registry, so
 * this is safe even when multiple spec files run in the same worker.
 */
export interface TestAppContext {
  app: INestApplication;
  mongod: MongoMemoryServer;
}

const TEST_KMS_MASTER_KEY_HEX = '22'.repeat(32);
const TEST_PASSWORD_PEPPER = 'integration-test-pepper';

export async function buildTestApp(opts: { corsOrigin?: string } = {}): Promise<TestAppContext> {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  process.env.KMS_MASTER_KEY_HEX = TEST_KMS_MASTER_KEY_HEX;
  process.env.PASSWORD_PEPPER = TEST_PASSWORD_PEPPER;
  delete process.env.GCS_DATA_BUCKET; // keep storageProviderProvider on FakeStorageProvider
  delete process.env.RESEND_API_KEY; // keep notificationProviderProvider on FakeNotificationProvider

  const { AppModule } = await import('../../src/app.module');
  const { REDIS_APP_CLIENT } = await import('../../src/redis.provider');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS_APP_CLIENT)
    .useValue(new RedisMock())
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.use(cookieParser());
  // Must run before init() — Express wires CORS as ordered middleware, so enabling it after
  // init() (once routing is already bound) silently no-ops and preflight OPTIONS 404s. Opt-in
  // only (undefined by default): apps/api/src/main.ts itself enables no CORS at all (same-origin
  // assumed today), and every existing integration spec calls buildTestApp() through supertest
  // directly against the Nest app instance, which never goes through a browser's CORS layer
  // anyway — this only matters for the Phase 2 UI plan's dev-server.ts harness.
  if (opts.corsOrigin) app.enableCors({ origin: opts.corsOrigin, credentials: true });
  await app.init();

  return { app, mongod };
}

export async function closeTestApp(ctx: TestAppContext): Promise<void> {
  await ctx.app.close();
  await ctx.mongod.stop();
}
