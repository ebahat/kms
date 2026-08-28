import 'reflect-metadata';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Test, TestingModule } from '@nestjs/testing';

/**
 * Real integration-test harness for `apps/worker`, mirroring `apps/api/test/support/test-app.ts`:
 * a genuine in-process `mongod` via MongoMemoryServer, no live Mongo needed. No Redis involved at
 * all — `WorkerModule` has no dependency on it (BullMQ connection setup lives in `main.ts`, not the
 * DI module), which is exactly why this pass tests processors as plain in-process function calls
 * rather than a live queue round-trip (see the plan's own scope note on that).
 *
 * `WorkerModule` reads `process.env.MONGO_URI` at class-definition time, so it's imported
 * dynamically here *after* the env var is set.
 */
export interface TestWorkerAppContext {
  moduleRef: TestingModule;
  mongod: MongoMemoryServer;
}

export async function buildTestWorkerApp(): Promise<TestWorkerAppContext> {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  delete process.env.S3_DATA_BUCKET;
  delete process.env.GCS_DATA_BUCKET;
  delete process.env.OCI_DATA_BUCKET; // keep storageProviderProvider on FakeStorageProvider
  delete process.env.CLAMD_HOST; // keep scanProviderProvider on FakePassThroughScanProvider
  delete process.env.VERTEX_PROJECT_ID; // keep embeddingProviderProvider on FakeEmbeddingProvider

  const { WorkerModule } = await import('../../src/worker.module');
  const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();

  return { moduleRef, mongod };
}

/** Guards against `ctx` never having been assigned — if `buildTestWorkerApp()` itself threw in `beforeAll`, `afterAll` still runs and would otherwise fault on `undefined`, masking the real error. */
export async function closeTestWorkerApp(ctx: TestWorkerAppContext | undefined): Promise<void> {
  if (!ctx) return;
  await ctx.moduleRef.close();
  await ctx.mongod.stop();
}
