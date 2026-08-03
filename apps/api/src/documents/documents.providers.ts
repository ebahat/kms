import { Provider } from '@nestjs/common';
import { FakeStorageProvider, GcsStorageProvider, StorageProvider } from './storage/storage-provider';
import { IngestionQueue, LoggingIngestionQueue } from './ingestion-queue';

export const STORAGE_PROVIDER = 'STORAGE_PROVIDER' as const;
export const INGESTION_QUEUE = 'INGESTION_QUEUE' as const;

/**
 * GcsStorageProvider needs live GCP credentials and a real bucket
 * (ADR-0006/0007), neither of which exist in this environment (infra/ not
 * yet applied — root CLAUDE.md). Falls back to the in-memory
 * FakeStorageProvider whenever GCS_DATA_BUCKET isn't set, so local dev and
 * tests keep working; set the env var once a real bucket exists.
 */
export const storageProviderProvider: Provider = {
  provide: STORAGE_PROVIDER,
  useFactory: (): StorageProvider => {
    const bucket = process.env.GCS_DATA_BUCKET;
    return bucket ? new GcsStorageProvider(bucket) : new FakeStorageProvider();
  },
};

export const ingestionQueueProvider: Provider = {
  provide: INGESTION_QUEUE,
  useClass: LoggingIngestionQueue,
};

export type { StorageProvider, IngestionQueue };
