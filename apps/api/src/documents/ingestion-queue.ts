import { Logger } from '@nestjs/common';
import { ConnectionOptions, Queue } from 'bullmq';

/**
 * The structural hook into Phase 3's ingestion pipeline (ADR-0003). The real
 * BullMQ topology (scan -> parse -> chunk -> embed -> index) doesn't exist
 * yet — this interface lets the upload path enqueue now, in the same shape
 * Phase 3 will implement, without inventing queue infrastructure early.
 * `documents.status` is set to `queued` regardless of what this does.
 */
export interface IngestionQueue {
  enqueueScan(job: { tenantId: string; documentId: string; versionId: string }): void;
}

/** No-op stub (same pattern as CaptchaVerifier/SecurityAlertSink) — the default until `REDIS_QUEUE_HOST` is set (document-chat-rag plan, Part 1 Task 10). */
export class LoggingIngestionQueue implements IngestionQueue {
  private readonly logger = new Logger('IngestionQueue');

  enqueueScan(job: { tenantId: string; documentId: string; versionId: string }): void {
    this.logger.log(`scan stage stub: would enqueue ${JSON.stringify(job)} (Phase 3)`);
  }
}

/** Real BullMQ producer for the `scan` queue — `apps/worker`'s `parse`-pool `Worker` is the consumer (document-chat-rag plan). `enqueueScan` stays synchronous/fire-and-forget by interface contract; a failed enqueue is logged, never thrown into the upload request (a document simply stays `queued` forever, the same visible failure mode `LoggingIngestionQueue` already has by design). */
export class BullMqIngestionQueue implements IngestionQueue {
  private readonly logger = new Logger('IngestionQueue');
  private readonly queue: Queue<{ tenantId: string; documentId: string; versionId: string }>;

  constructor(connection: ConnectionOptions) {
    this.queue = new Queue('scan', { connection });
  }

  enqueueScan(job: { tenantId: string; documentId: string; versionId: string }): void {
    this.queue.add('scan', job).catch((err) => this.logger.error(`failed to enqueue scan job: ${(err as Error).message}`));
  }

  /** Not part of the `IngestionQueue` interface — a graceful-shutdown hook for the owning provider/test, not something upload-path callers need. */
  close(): Promise<void> {
    return this.queue.close();
  }
}
