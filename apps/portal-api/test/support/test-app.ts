import 'reflect-metadata';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import RedisMock from 'ioredis-mock';

/**
 * Real integration-test harness for apps/portal-api, mirroring apps/api/test/support/test-app.ts
 * (Task 9's own precedent) — a real (not mocked) mongod in-process via MongoMemoryServer, with
 * ioredis-mock standing in for redis-app. Built specifically to close a real gap: the Phase C
 * follow-up (tenant edit/admin-list/password-reset endpoints) had a bug — a synthetic CLS scope
 * set around an unawaited lazy Mongoose query — that every existing unit test (mocked
 * TenantsRepository/UsersRepository) was structurally unable to catch, since mocks never exercise
 * the real tenantScopeBackstopPlugin pre-hook. Only live-browser verification against a real Mongo
 * instance caught it; this harness makes that kind of bug catchable by an automated test instead.
 */
export interface TestAppContext {
  app: INestApplication;
  mongod: MongoMemoryServer;
}

const TEST_KMS_MASTER_KEY_HEX = '22'.repeat(32);
const TEST_PASSWORD_PEPPER = 'integration-test-pepper';

export async function buildTestApp(): Promise<TestAppContext> {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  process.env.KMS_MASTER_KEY_HEX = TEST_KMS_MASTER_KEY_HEX;
  process.env.PASSWORD_PEPPER = TEST_PASSWORD_PEPPER;
  delete process.env.GCS_DATA_BUCKET;
  delete process.env.S3_DATA_BUCKET;
  delete process.env.OCI_DATA_BUCKET; // keep storageProviderProvider on FakeStorageProvider

  const { AppModule } = await import('../../src/app.module');
  const { REDIS_APP_CLIENT } = await import('../../src/redis.provider');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS_APP_CLIENT)
    .useValue(new RedisMock())
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.use(cookieParser());
  await app.init();

  return { app, mongod };
}

export async function closeTestApp(ctx: TestAppContext): Promise<void> {
  await ctx.app.close();
  await ctx.mongod.stop();
}
