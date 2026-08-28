import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClsModule } from 'nestjs-cls';
import {
  AuditEvent,
  AuditEventSchema,
  AuditEventsRepository,
  Chunk,
  ChunkSchema,
  ChunksRepository,
  Document,
  DocumentSchema,
  DocumentsRepository,
  DocumentVersion,
  DocumentVersionSchema,
  DocumentVersionsRepository,
} from '@kms/data';
import { EMBEDDING_PROVIDER, embeddingProviderProvider, SCAN_PROVIDER, scanProviderProvider, STORAGE_PROVIDER, storageProviderProvider } from './worker.providers';

/**
 * A Nest **application context**, not an HTTP server — `apps/worker` has no
 * routes, no guards, no `SessionAuthGuard` to populate CLS per request.
 * `main.ts` opens a CLS run-context manually per BullMQ job instead (see its
 * own doc comment) — this module only supplies the DI graph both need:
 * schema-backed repositories and the Fake/real provider factories (tokens
 * and factories live in `worker.providers.ts` — see that file's doc comment
 * for why the split matters for tests, not just organization).
 */
@Module({
  imports: [
    ClsModule.forRoot({ global: true }), // no middleware:mount — there is no HTTP layer to mount into
    MongooseModule.forRoot(process.env.MONGO_URI ?? 'mongodb://localhost:27017/kms'),
    MongooseModule.forFeature([
      { name: Document.name, schema: DocumentSchema },
      { name: DocumentVersion.name, schema: DocumentVersionSchema },
      { name: Chunk.name, schema: ChunkSchema },
      { name: AuditEvent.name, schema: AuditEventSchema },
    ]),
  ],
  providers: [
    DocumentsRepository,
    DocumentVersionsRepository,
    ChunksRepository,
    AuditEventsRepository,
    storageProviderProvider,
    scanProviderProvider,
    embeddingProviderProvider,
  ],
  exports: [DocumentsRepository, DocumentVersionsRepository, ChunksRepository, AuditEventsRepository, STORAGE_PROVIDER, SCAN_PROVIDER, EMBEDDING_PROVIDER],
})
export class WorkerModule {}
