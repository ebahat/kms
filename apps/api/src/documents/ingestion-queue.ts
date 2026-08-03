import { Logger } from '@nestjs/common';

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

/** No-op stub (same pattern as CaptchaVerifier/SecurityAlertSink) — swapped for a real BullMQ producer in Phase 3. */
export class LoggingIngestionQueue implements IngestionQueue {
  private readonly logger = new Logger('IngestionQueue');

  enqueueScan(job: { tenantId: string; documentId: string; versionId: string }): void {
    this.logger.log(`scan stage stub: would enqueue ${JSON.stringify(job)} (Phase 3)`);
  }
}
