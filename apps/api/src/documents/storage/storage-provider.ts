import { Storage, Bucket } from '@google-cloud/storage';

/**
 * Object storage abstraction (ADR-0006). Deliberately minimal — only what
 * the upload path (Phase 2.3) needs; signed-URL issuance (2.4) and deletion
 * (2.5) add methods here when those phases actually build them, per the
 * phase-2 plan's YAGNI note (no shared libs/storage package, just this
 * interface, mirroring libs/auth's KmsKeyProvider pattern).
 */
export interface StorageProvider {
  putObject(key: string, data: Buffer, opts: { contentType: string }): Promise<void>;
}

/**
 * ADR-0006 bucket layout: `tenants/{tenantId}/versions/{versionId}` — the
 * one audited function that builds this key. Object keys contain only
 * server-generated ids, never the original filename (sec §4.4 path-traversal
 * guard) — the display name lives in DocumentVersion.originalFilename.
 */
export function buildVersionObjectKey(tenantId: string, versionId: string): string {
  return `tenants/${tenantId}/versions/${versionId}`;
}

/**
 * Dev/test binding — an in-memory map standing in for the `kms-{env}-data`
 * bucket (ADR-0006). Never durable, never shared across processes; the
 * production binding is GcsStorageProvider once infra/ is applied.
 */
export class FakeStorageProvider implements StorageProvider {
  private readonly objects = new Map<string, { data: Buffer; contentType: string }>();

  async putObject(key: string, data: Buffer, opts: { contentType: string }): Promise<void> {
    this.objects.set(key, { data, contentType: opts.contentType });
  }

  /** Test-only inspection hook — not part of the StorageProvider contract. */
  peek(key: string): { data: Buffer; contentType: string } | undefined {
    return this.objects.get(key);
  }
}

/**
 * Production binding for the `kms-{env}-data` bucket (ADR-0006). Uses
 * Application Default Credentials — uninstantiable without live GCP
 * credentials, which this environment does not have (root CLAUDE.md).
 * Not exercised by any test; wired for real once infra/ is applied.
 */
export class GcsStorageProvider implements StorageProvider {
  private readonly bucket: Bucket;

  constructor(bucketName: string) {
    this.bucket = new Storage().bucket(bucketName);
  }

  async putObject(key: string, data: Buffer, opts: { contentType: string }): Promise<void> {
    await this.bucket.file(key).save(data, { contentType: opts.contentType, resumable: false });
  }
}
