import { ClsService } from 'nestjs-cls';
import {
  AuditEventsRepository,
  ChunksRepository,
  DocumentsRepository,
  DocumentVersionsRepository,
  newObjectId,
  Scope,
  SCOPE_CLS_KEY,
} from '@kms/data';
import { buildVersionObjectKey, MIME_TYPES, StorageProvider, ScanProvider } from '@kms/storage';
import { EmbeddingProvider } from '@kms/ai-providers';
import { scanProcessor } from '../src/jobs/scan.processor';
import { parseProcessor } from '../src/jobs/parse.processor';
import { chunkProcessor } from '../src/jobs/chunk.processor';
import { embedProcessor } from '../src/jobs/embed.processor';
import { indexProcessor } from '../src/jobs/index.processor';
import { StageJobData, WorkerContext } from '../src/jobs/worker-context';
import { STORAGE_PROVIDER, SCAN_PROVIDER, EMBEDDING_PROVIDER } from '../src/worker.providers';
import { buildTestWorkerApp, closeTestWorkerApp, TestWorkerAppContext } from './support/test-worker-app';
import { buildFixtureDocx } from './support/docx-fixture';

/**
 * Real ingestion pipeline, end to end (document-chat-rag plan, Part 1 Task 11): a genuine DOCX
 * fixture flows through every stage as real, unmocked processor logic against real Mongo
 * (mongodb-memory-server) and the real `FakeStorageProvider`/`FakePassThroughScanProvider`/
 * `FakeEmbeddingProvider` bindings — everything except a live BullMQ round-trip (processors are
 * called directly, in sequence, per the plan's own scope note; task 12 covers a best-effort live
 * check separately). PDF parsing is exercised separately and only via mocked `pdf-parse`
 * (`apps/worker/src/jobs/parse.processor.spec.ts`, `libs/parsing/src/pdf-parser.spec.ts`) — there is
 * no lightweight way to hand-construct a real text-layer PDF fixture in this sandbox the way a
 * minimal valid DOCX can be built from raw XML.
 */
describe('ingestion pipeline (real DOCX fixture → scan → parse → chunk → embed → index)', () => {
  let ctx: TestWorkerAppContext;
  let workerCtx: WorkerContext;
  let cls: ClsService;

  beforeAll(async () => {
    ctx = await buildTestWorkerApp();
    cls = ctx.moduleRef.get(ClsService);
    workerCtx = {
      documents: ctx.moduleRef.get(DocumentsRepository),
      documentVersions: ctx.moduleRef.get(DocumentVersionsRepository),
      chunks: ctx.moduleRef.get(ChunksRepository),
      auditEvents: ctx.moduleRef.get(AuditEventsRepository),
      storage: ctx.moduleRef.get<StorageProvider>(STORAGE_PROVIDER),
      scanProvider: ctx.moduleRef.get<ScanProvider>(SCAN_PROVIDER),
      embeddingProvider: ctx.moduleRef.get<EmbeddingProvider>(EMBEDDING_PROVIDER),
      queues: {
        scan: { add: jest.fn() } as any,
        parse: { add: jest.fn() } as any,
        chunk: { add: jest.fn() } as any,
        embed: { add: jest.fn() } as any,
        index: { add: jest.fn() } as any,
      },
    };
  }, 60_000);

  afterAll(async () => {
    await closeTestWorkerApp(ctx);
  });

  async function runFullPipeline(job: { data: StageJobData }, scope: Scope): Promise<void> {
    await cls.run(async () => {
      cls.set(SCOPE_CLS_KEY, scope);
      await scanProcessor(job as any, workerCtx);
      await parseProcessor(job as any, workerCtx);
      await chunkProcessor(job as any, workerCtx);
      await embedProcessor(job as any, workerCtx);
      await indexProcessor(job as any, workerCtx);
    });
  }

  it('indexes a real DOCX end-to-end: chunks are written, scoped to the correct folder, with real fake-hashed embeddings and correct language detection', async () => {
    const tenantId = newObjectId();
    const folderId = newObjectId();
    const documentId = newObjectId();
    const versionId = newObjectId();
    const scope: Scope = { tenantId, userId: newObjectId(), role: 'admin', edition: 'kb', featureToggles: [] };

    const docxBytes = await buildFixtureDocx(['פסקה ראשונה עם תוכן לבדיקה של הצינור.', 'פסקה שנייה עם תוכן נוסף לבדיקה.']);
    const storageKey = buildVersionObjectKey(tenantId.toString(), versionId.toString());

    await cls.run(async () => {
      cls.set(SCOPE_CLS_KEY, scope);
      await workerCtx.storage.putObject(storageKey, docxBytes, { contentType: MIME_TYPES.docx });
      await workerCtx.documentVersions.createVersion({
        id: versionId,
        documentId,
        versionNumber: 1,
        storageKey,
        originalFilename: 'test.docx',
        mimeType: MIME_TYPES.docx,
        sizeBytes: docxBytes.length,
        contentHashSha256: 'deadbeef',
        uploadedBy: scope.userId,
      });
      await workerCtx.documents.createDocument({ id: documentId, folderId, name: 'test.docx', latestVersionId: versionId, createdBy: scope.userId });
    });

    await runFullPipeline({ data: { tenantId: tenantId.toString(), documentId: documentId.toString(), versionId: versionId.toString() } }, scope);

    await cls.run(async () => {
      cls.set(SCOPE_CLS_KEY, scope);

      const doc = await workerCtx.documents.findById(documentId);
      expect(doc?.status).toBe('indexed');

      const chunks = await workerCtx.chunks.findByScope([folderId]);
      expect(chunks).toHaveLength(1); // both short paragraphs fit under one chunk's target size
      expect(chunks[0].text).toContain('פסקה ראשונה');
      expect(chunks[0].text).toContain('פסקה שנייה');
      expect(chunks[0].folderId.toString()).toBe(folderId.toString());
      expect(chunks[0].documentId.toString()).toBe(documentId.toString());
      expect(chunks[0].embeddingModel).toBe('fake-hashed-768');
      expect(chunks[0].embedding).toHaveLength(768);
      expect(chunks[0].lang).toBe('he');
    });
  }, 30_000);

  it('purge-then-insert: re-indexing a new version fully replaces the prior version\'s chunks, never accumulates', async () => {
    const tenantId = newObjectId();
    const folderId = newObjectId();
    const documentId = newObjectId();
    const versionId1 = newObjectId();
    const versionId2 = newObjectId();
    const scope: Scope = { tenantId, userId: newObjectId(), role: 'admin', edition: 'kb', featureToggles: [] };

    const seedVersion = async (versionId: ReturnType<typeof newObjectId>, text: string, versionNumber: number) => {
      const bytes = await buildFixtureDocx([text]);
      const storageKey = buildVersionObjectKey(tenantId.toString(), versionId.toString());
      await cls.run(async () => {
        cls.set(SCOPE_CLS_KEY, scope);
        await workerCtx.storage.putObject(storageKey, bytes, { contentType: MIME_TYPES.docx });
        await workerCtx.documentVersions.createVersion({
          id: versionId,
          documentId,
          versionNumber,
          storageKey,
          originalFilename: `v${versionNumber}.docx`,
          mimeType: MIME_TYPES.docx,
          sizeBytes: bytes.length,
          contentHashSha256: `hash-${versionNumber}`,
          uploadedBy: scope.userId,
        });
      });
    };

    await cls.run(async () => {
      cls.set(SCOPE_CLS_KEY, scope);
      await workerCtx.documents.createDocument({ id: documentId, folderId, name: 'doc.docx', latestVersionId: versionId1, createdBy: scope.userId });
    });

    await seedVersion(versionId1, 'תוכן הגרסה הראשונה של המסמך.', 1);
    await runFullPipeline({ data: { tenantId: tenantId.toString(), documentId: documentId.toString(), versionId: versionId1.toString() } }, scope);

    await seedVersion(versionId2, 'תוכן שונה לחלוטין של הגרסה השנייה.', 2);
    await cls.run(async () => {
      cls.set(SCOPE_CLS_KEY, scope);
      await workerCtx.documents.setLatestVersion(documentId, versionId2);
    });
    await runFullPipeline({ data: { tenantId: tenantId.toString(), documentId: documentId.toString(), versionId: versionId2.toString() } }, scope);

    await cls.run(async () => {
      cls.set(SCOPE_CLS_KEY, scope);
      const chunks = await workerCtx.chunks.findByScope([folderId]);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].versionId.toString()).toBe(versionId2.toString());
      expect(chunks[0].text).toContain('הגרסה השנייה');
    });
  }, 30_000);
});
