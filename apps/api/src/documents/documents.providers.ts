import { Provider } from '@nestjs/common';
import { FakeStorageProvider, GcsStorageProvider, OciStorageProvider, StorageProvider } from './storage/storage-provider';
import { IngestionQueue, LoggingIngestionQueue } from './ingestion-queue';

export const STORAGE_PROVIDER = 'STORAGE_PROVIDER' as const;
export const INGESTION_QUEUE = 'INGESTION_QUEUE' as const;

/**
 * Both GcsStorageProvider and OciStorageProvider need live cloud credentials
 * and a real bucket (ADR-0006/ADR-0014) — as of this writing neither exists
 * in this environment (infra/ not yet applied — root CLAUDE.md). Falls back
 * to the in-memory FakeStorageProvider when neither *_DATA_BUCKET env var is
 * set, so local dev and tests keep working. GCS takes precedence if both
 * happen to be set (preserves prior behavior unchanged; not expected in
 * practice — a deployment targets one cloud). OCI's binding is async
 * (instance-principal identity resolution — see OciStorageProvider's doc
 * comment), which is why this factory itself is async; NestJS supports that
 * natively for useFactory.
 */
export const storageProviderProvider: Provider = {
  provide: STORAGE_PROVIDER,
  useFactory: async (): Promise<StorageProvider> => {
    const gcsBucket = process.env.GCS_DATA_BUCKET;
    if (gcsBucket) return new GcsStorageProvider(gcsBucket);

    const ociBucket = process.env.OCI_DATA_BUCKET;
    if (ociBucket) {
      const namespace = process.env.OCI_NAMESPACE;
      const region = process.env.OCI_REGION;
      if (!namespace || !region) throw new Error('OCI_DATA_BUCKET is set but OCI_NAMESPACE and/or OCI_REGION is missing');
      return OciStorageProvider.withInstancePrincipals(namespace, ociBucket, region);
    }

    return new FakeStorageProvider();
  },
};

export const ingestionQueueProvider: Provider = {
  provide: INGESTION_QUEUE,
  useClass: LoggingIngestionQueue,
};

export type { StorageProvider, IngestionQueue };
