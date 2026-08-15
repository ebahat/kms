import { Storage, Bucket } from '@google-cloud/storage';
import * as objectstorage from 'oci-objectstorage';
import * as common from 'oci-common';

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

/**
 * Production binding for OCI Object Storage (ADR-0014, rebinding ADR-0006 off GCS). Uses instance
 * principals — the OCI equivalent of GCS's Application Default Credentials — so no static key file
 * needs to live on the deployed instance; construct via {@link OciStorageProvider.withInstancePrincipals}
 * rather than the constructor directly, since resolving that identity is inherently async. Not
 * exercised by any test — same reasoning as GcsStorageProvider: uninstantiable without live OCI
 * credentials, which this environment doesn't have.
 *
 * Known divergence from GcsStorageProvider, not a bug: GCS's V4 signed URLs accept a
 * `responseDisposition` override *at signing time*, so a fresh Content-Disposition (with the
 * caller-supplied display filename) can be set on every download. OCI pre-authenticated requests
 * (PARs) have no equivalent — Content-Disposition can only be set as object metadata *at upload
 * time* (`putObject`'s `contentDisposition` field) and is then fixed for the object's lifetime. Since
 * `StorageProvider.putObject` doesn't receive a display filename (only `contentType`), this binding
 * sets a generic `attachment` disposition at upload time — that alone still satisfies sec §4.4's
 * "never render inline" requirement, but the caller-supplied `displayFilename` passed to
 * `getSignedDownloadUrl` is accepted for interface compatibility only and has no effect on what
 * filename the browser shows. Threading the real filename through would require extending
 * `StorageProvider.putObject`'s signature — deliberately not done here to avoid changing the shared
 * interface for a binding nothing currently deploys against; revisit if/when OCI becomes the actual
 * production target with a real filename-on-download requirement.
 */
export class OciStorageProvider implements StorageProvider {
  private readonly client: objectstorage.ObjectStorageClient;

  constructor(
    private readonly namespace: string,
    private readonly bucketName: string,
    private readonly region: string,
    authenticationDetailsProvider: common.AuthenticationDetailsProvider,
  ) {
    this.client = new objectstorage.ObjectStorageClient({ authenticationDetailsProvider });
  }

  /** Resolves the instance-principal identity (async by nature) before constructing the client. */
  static async withInstancePrincipals(namespace: string, bucketName: string, region: string): Promise<OciStorageProvider> {
    const provider = await new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
    return new OciStorageProvider(namespace, bucketName, region, provider);
  }

  async putObject(key: string, data: Buffer, opts: { contentType: string }): Promise<void> {
    await this.client.putObject({
      namespaceName: this.namespace,
      bucketName: this.bucketName,
      objectName: key,
      putObjectBody: data,
      contentLength: data.length,
      contentType: opts.contentType,
      // Generic, filename-less attachment disposition — see class doc comment for why a real
      // per-download filename can't be threaded through here the way GCS's signed URLs support.
      contentDisposition: 'attachment',
    });
  }

  async getSignedDownloadUrl(key: string, _opts: { displayFilename: string }): Promise<SignedDownloadUrl> {
    const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_MS);
    const response = await this.client.createPreauthenticatedRequest({
      namespaceName: this.namespace,
      bucketName: this.bucketName,
      createPreauthenticatedRequestDetails: {
        // Unique per issuance (never reused/stored, matches ADR-0006's "issued per click" rule) —
        // the name is OCI-internal bookkeeping, never shown to the end user.
        name: `download-${key}-${Date.now()}`,
        objectName: key,
        accessType: objectstorage.models.CreatePreauthenticatedRequestDetails.AccessType.ObjectRead,
        timeExpires: expiresAt,
      },
    });
    const url = `https://objectstorage.${this.region}.oraclecloud.com${response.preauthenticatedRequest.accessUri}`;
    return { url, expiresAt };
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.headObject({ namespaceName: this.namespace, bucketName: this.bucketName, objectName: key });
      return true;
    } catch (err) {
      if (err instanceof common.OciError && err.statusCode === 404) return false;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.deleteObject({ namespaceName: this.namespace, bucketName: this.bucketName, objectName: key });
    } catch (err) {
      // Idempotent: deleting an already-absent key is not an error (mirrors GcsStorageProvider's
      // ignoreNotFound: true) — a retried purge must not fail.
      if (err instanceof common.OciError && err.statusCode === 404) return;
      throw err;
    }
  }
}
