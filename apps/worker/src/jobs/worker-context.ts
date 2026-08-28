import { Queue } from 'bullmq';
import {
  AuditEventsRepository,
  ChunksRepository,
  DocumentsRepository,
  DocumentVersionsRepository,
  Scope,
  toObjectId,
} from '@kms/data';
import { EmbeddingProvider } from '@kms/ai-providers';
import { ScanProvider, StorageProvider } from '@kms/storage';

/** Every stage queue this pass actually processes — `ocr-classic`/`ocr-advanced` are a deliberate cut (master plan 3.6), so no Worker/Queue is constructed for them. */
export type StageQueueName = 'scan' | 'parse' | 'chunk' | 'embed' | 'index';

export type StageJobData = {
  tenantId: string;
  documentId: string;
  versionId: string;
};

export type WorkerContext = {
  documents: DocumentsRepository;
  documentVersions: DocumentVersionsRepository;
  chunks: ChunksRepository;
  auditEvents: AuditEventsRepository;
  storage: StorageProvider;
  scanProvider: ScanProvider;
  embeddingProvider: EmbeddingProvider;
  queues: Record<StageQueueName, Queue<StageJobData>>;
};

/**
 * A background job has no real acting user (unlike an HTTP request, which
 * gets one from `SessionAuthGuard`) — this fixed sentinel ObjectId is the
 * `actorUserId` every worker-originated audit event carries, so it's
 * immediately recognizable as system/worker-originated rather than
 * attributable to a real account. Not `SystemScope` (that escape hatch is
 * for cross-tenant platform operations; every worker job is scoped to
 * exactly one tenant, taken from the job payload, so a normal per-tenant
 * `Scope` — just with this synthetic actor — is the correct fit).
 */
export const WORKER_SYSTEM_USER_ID = toObjectId('000000000000000000000000');

export function scopeForJob(tenantId: string): Scope {
  return {
    tenantId: toObjectId(tenantId),
    userId: WORKER_SYSTEM_USER_ID,
    role: 'admin',
    edition: 'kb',
    featureToggles: [],
  };
}
