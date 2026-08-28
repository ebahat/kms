import { BullMqIngestionQueue, LoggingIngestionQueue } from './ingestion-queue';

describe('LoggingIngestionQueue', () => {
  it('does not throw — a fire-and-forget no-op stub', () => {
    const queue = new LoggingIngestionQueue();
    expect(() => queue.enqueueScan({ tenantId: 't1', documentId: 'd1', versionId: 'v1' })).not.toThrow();
  });
});

describe('BullMqIngestionQueue', () => {
  it('enqueueScan never throws synchronously, even against an unreachable Redis (the upload request must never fail because of this)', async () => {
    // Port 1 is a reserved/unassigned TCP port — nothing is ever listening there, so the underlying
    // connection attempt is guaranteed to fail, without this test depending on a live Redis or
    // emulating BullMQ/ioredis's real connection handshake.
    const queue = new BullMqIngestionQueue({ host: '127.0.0.1', port: 1, retryStrategy: () => null, maxRetriesPerRequest: 0 } as any);

    expect(() => queue.enqueueScan({ tenantId: 't1', documentId: 'd1', versionId: 'v1' })).not.toThrow();

    await queue.close();
  });
});
