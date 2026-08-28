import 'reflect-metadata';
import { ConnectionOptions, Queue, Worker } from 'bullmq';
import { NestFactory } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { AuditEventsRepository, ChunksRepository, DocumentsRepository, DocumentVersionsRepository, SCOPE_CLS_KEY } from '@kms/data';
import { EmbeddingProvider } from '@kms/ai-providers';
import { ScanProvider, StorageProvider } from '@kms/storage';
import { loadQueueEnv } from '@kms/config';
import { resolveWorkerPool, POOL_QUEUES } from './pools';
import { WorkerModule } from './worker.module';
import { EMBEDDING_PROVIDER, SCAN_PROVIDER, STORAGE_PROVIDER } from './worker.providers';
import { scanProcessor } from './jobs/scan.processor';
import { parseProcessor } from './jobs/parse.processor';
import { chunkProcessor } from './jobs/chunk.processor';
import { embedProcessor } from './jobs/embed.processor';
import { indexProcessor } from './jobs/index.processor';
import { scopeForJob, StageJobData, StageQueueName, WorkerContext } from './jobs/worker-context';

/** `ocr-classic`/`ocr-advanced` have no registered processor this pass — a deliberate cut (master plan 3.6), not an oversight. No Worker is constructed for them, and nothing ever enqueues into them (the `parse` stage never routes there). */
const PROCESSORS: Partial<Record<StageQueueName, (job: import('bullmq').Job<StageJobData>, ctx: WorkerContext) => Promise<void>>> = {
  scan: scanProcessor,
  parse: parseProcessor,
  chunk: chunkProcessor,
  embed: embedProcessor,
  index: indexProcessor,
};

/** Built as an explicit object literal (not a mapped/`Object.fromEntries` loop) so each `Queue<StageJobData>` keeps its concrete generic type — a mapped construction loses enough of it that `WorkerContext['queues']`'s type stops matching. */
function makeStageQueues(connection: ConnectionOptions): WorkerContext['queues'] {
  return {
    scan: new Queue<StageJobData>('scan', { connection }),
    parse: new Queue<StageJobData>('parse', { connection }),
    chunk: new Queue<StageJobData>('chunk', { connection }),
    embed: new Queue<StageJobData>('embed', { connection }),
    index: new Queue<StageJobData>('index', { connection }),
  };
}

async function bootstrap() {
  const pool = resolveWorkerPool();
  const queueNamesForPool = POOL_QUEUES[pool];
  console.log(`worker pool "${pool}" starting, consuming queues: ${queueNamesForPool.join(', ')}`);

  const { REDIS_QUEUE_HOST } = loadQueueEnv();
  // A plain options object (not a constructed ioredis instance) — BullMQ builds its own client from
  // this internally, sidestepping any cross-package ioredis version-identity mismatch between what
  // this app installs and what bullmq's own dependency tree resolves to.
  const connection: ConnectionOptions = { host: REDIS_QUEUE_HOST, maxRetriesPerRequest: null };

  const app = await NestFactory.createApplicationContext(WorkerModule);
  const cls = app.get(ClsService);
  const ctx: WorkerContext = {
    documents: app.get(DocumentsRepository),
    documentVersions: app.get(DocumentVersionsRepository),
    chunks: app.get(ChunksRepository),
    auditEvents: app.get(AuditEventsRepository),
    storage: app.get<StorageProvider>(STORAGE_PROVIDER),
    scanProvider: app.get<ScanProvider>(SCAN_PROVIDER),
    embeddingProvider: app.get<EmbeddingProvider>(EMBEDDING_PROVIDER),
    // Producer clients for every stage, regardless of this process's own pool — the chain
    // crosses pool boundaries (e.g. the parse pool's `parse` stage hands off to the ai pool's
    // `chunk` queue), so every processor needs to be able to enqueue any later stage.
    queues: makeStageQueues(connection),
  };

  const workers = queueNamesForPool
    .filter((name): name is StageQueueName => name in PROCESSORS)
    .map((name) => {
      const processor = PROCESSORS[name]!;
      return new Worker<StageJobData>(
        name,
        (job) => cls.run(() => {
          cls.set(SCOPE_CLS_KEY, scopeForJob(job.data.tenantId));
          return processor(job, ctx);
        }),
        { connection },
      );
    });

  console.log(`worker pool "${pool}" ready — ${workers.length} queue(s) consumed`);
}

bootstrap();
