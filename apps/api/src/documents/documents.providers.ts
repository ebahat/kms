import { Provider } from '@nestjs/common';
import { FakeStorageProvider, GcsStorageProvider, OciStorageProvider, S3StorageProvider, StorageProvider } from './storage/storage-provider';
import { IngestionQueue, LoggingIngestionQueue } from './ingestion-queue';

export const STORAGE_PROVIDER = 'STORAGE_PROVIDER' as const;
export const INGESTION_QUEUE = 'INGESTION_QUEUE' as const;

/**
 * Selects a storage binding from the environment. Every production binding
 * needs live cloud credentials and a real bucket (ADR-0006/ADR-0014/ADR-0015);
 * none exists in this environment yet (nothing applied — root CLAUDE.md), so
 * the fallback is the in-memory FakeStorageProvider and local dev/tests keep
 * working untouched.
 *
 * Precedence is explicit rather than incidental: S3 first, because
 * S3StorageProvider is the *portable* one (ADR-0015 — it also drives Hetzner,
 * OCI-compat, R2, B2 and MinIO), so a deployment that sets S3_DATA_BUCKET
 * means it. GCS and OCI keep their prior relative order so existing behavior
 * is unchanged. A deployment targets exactly one cloud in practice; multiple
 * vars set at once is a misconfiguration, and first-match-wins keeps it
 * predictable instead of merging.
 *
 * The factory is async because OciStorageProvider resolves an instance-
 * principal identity before it can be constructed (see its doc comment);
 * NestJS supports async useFactory natively.
 */
export const storageProviderProvider: Provider = {
  provide: STORAGE_PROVIDER,
  useFactory: async (): Promise<StorageProvider> => {
    const s3Bucket = process.env.S3_DATA_BUCKET;
    if (s3Bucket) {
      const region = process.env.S3_REGION;
      if (!region) throw new Error('S3_DATA_BUCKET is set but S3_REGION is missing');
      return new S3StorageProvider(s3Bucket, {
        region,
        // Unset for real AWS; set for Hetzner / OCI-compat / R2 / MinIO.
        endpoint: process.env.S3_ENDPOINT,
        // Most non-AWS S3 implementations need path-style addressing. Defaults to the SDK's own
        // behavior (virtual-hosted) unless explicitly opted in.
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true' ? true : undefined,
      });
    }

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
