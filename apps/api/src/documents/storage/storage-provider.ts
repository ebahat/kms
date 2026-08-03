import { Storage, Bucket } from '@google-cloud/storage';

export const SIGNED_URL_TTL_MS = 5 * 60_000; // ADR-0006: 5 minutes, issued per click, never stored

export interface SignedDownloadUrl {
  url: string;
  expiresAt: Date;
}

/**
 * Object storage abstraction (ADR-0006). Deliberately minimal — only what
 * the upload path (Phase 2.3), download path (Phase 2.4), and deletion
 * path (Phase 2.5) need; no shared libs/storage package, just this
 * interface, mirroring libs/auth's KmsKeyProvider pattern.
 */
export interface StorageProvider {
  putObject(key: string, data: Buffer, opts: { contentType: string }): Promise<void>;

  /**
   * V4 signed URL, single object, 5-minute expiry (ADR-0006). Always forces
   * an attachment download with a generic content-type — the file is never
   * rendered inline, regardless of what it actually is (sec §4.4).
   */
  getSignedDownloadUrl(key: string, opts: { displayFilename: string }): Promise<SignedDownloadUrl>;

  /** Deletion-verification input (sec §7.3) — never trust a delete succeeded without checking. */
  objectExists(key: string): Promise<boolean>;

  /** Idempotent: deleting an already-absent key is not an error (a retried purge must not fail). */
  deleteObject(key: string): Promise<void>;
}

/**
 * RFC 5987 encoding for a non-ASCII-safe Content-Disposition filename*
 * parameter — the display name is untrusted user input (sec §4.4), so it's
 * always percent-encoded, never interpolated raw into a header.
 */
export function encodeRfc5987Filename(name: string): string {
  return `UTF-8''${encodeURIComponent(name)}`;
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

  /**
   * Unlike real GCS (which signs a URL without checking the object exists —
   * failure surfaces only when the client fetches it), the fake checks
   * existence at signing time. Deliberate divergence: it turns a
   * wrong-key bug into an immediate, clear test failure instead of a URL
   * nobody ever notices was dead.
   */
  async getSignedDownloadUrl(key: string, opts: { displayFilename: string }): Promise<SignedDownloadUrl> {
    if (!this.objects.has(key)) throw new Error(`FakeStorageProvider: no object at key "${key}"`);
    return { url: `fake://storage/${key}?filename=${encodeURIComponent(opts.displayFilename)}`, expiresAt: new Date(Date.now() + SIGNED_URL_TTL_MS) };
  }

  async objectExists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
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

  async getSignedDownloadUrl(key: string, opts: { displayFilename: string }): Promise<SignedDownloadUrl> {
    const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_MS);
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expiresAt,
      responseType: 'application/octet-stream',
      responseDisposition: `attachment; filename*=${encodeRfc5987Filename(opts.displayFilename)}`,
    });
    return { url, expiresAt };
  }

  async objectExists(key: string): Promise<boolean> {
    const [exists] = await this.bucket.file(key).exists();
    return exists;
  }

  async deleteObject(key: string): Promise<void> {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }
}
