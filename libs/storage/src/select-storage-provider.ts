import { FakeStorageProvider, GcsStorageProvider, OciStorageProvider, S3StorageProvider, StorageProvider } from './storage-provider';

/**
 * Env-precedence storage-binding selection (ADR-0006/0014/0015), factored out
 * of `apps/api/src/documents/documents.providers.ts` so `apps/worker` (the
 * document-chat-rag plan's ingestion pipeline, 2026-08-28) selects the exact
 * same binding the upload path wrote through — a worker reading from a
 * different bucket than the API wrote to would silently see nothing.
 * `documents.providers.ts` keeps its own inline copy of this precedence
 * (not migrated here, to avoid touching an unrelated, already-tested call
 * site as a side effect of this plan); both must be kept in sync if the
 * precedence ever changes.
 */
export async function selectStorageProviderFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<StorageProvider> {
  const s3Bucket = env.S3_DATA_BUCKET;
  if (s3Bucket) {
    const region = env.S3_REGION;
    if (!region) throw new Error('S3_DATA_BUCKET is set but S3_REGION is missing');
    return new S3StorageProvider(s3Bucket, {
      region,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true' ? true : undefined,
    });
  }

  const gcsBucket = env.GCS_DATA_BUCKET;
  if (gcsBucket) return new GcsStorageProvider(gcsBucket);

  const ociBucket = env.OCI_DATA_BUCKET;
  if (ociBucket) {
    const namespace = env.OCI_NAMESPACE;
    const region = env.OCI_REGION;
    if (!namespace || !region) throw new Error('OCI_DATA_BUCKET is set but OCI_NAMESPACE and/or OCI_REGION is missing');
    return OciStorageProvider.withInstancePrincipals(namespace, ociBucket, region);
  }

  return new FakeStorageProvider();
}
