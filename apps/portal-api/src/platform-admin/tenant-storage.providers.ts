import { Provider } from '@nestjs/common';
import { FakeStorageProvider, FsStorageProvider, GcsStorageProvider, OciStorageProvider, S3StorageProvider, StorageProvider } from '@kms/storage';

export const STORAGE_PROVIDER = 'STORAGE_PROVIDER' as const;

/**
 * Portal-api's own StorageProvider binding (Phase C, C1.3) — mirrors
 * apps/api/src/documents/documents.providers.ts's selection logic exactly (same env vars, same
 * precedence), since a tenant logo lives in the same bucket/provider as documents. Portal-api had
 * no file-handling need at all before this — the binding is new here, the selection logic isn't.
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
        endpoint: process.env.S3_ENDPOINT,
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

    const fsDataDir = process.env.FS_DATA_DIR;
    if (fsDataDir) return new FsStorageProvider(fsDataDir);

    return new FakeStorageProvider();
  },
};

export type { StorageProvider };
