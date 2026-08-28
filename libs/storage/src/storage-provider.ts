import { Storage, Bucket } from '@google-cloud/storage';
import * as objectstorage from 'oci-objectstorage';
import * as common from 'oci-common';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MIME_TYPES } from './magic-byte-sniff';

export const SIGNED_URL_TTL_MS = 5 * 60_000; // ADR-0006: 5 minutes, issued per click, never stored

export interface SignedDownloadUrl {
  url: string;
  expiresAt: Date;
}

/**
 * Object storage abstraction (ADR-0006). Deliberately minimal — only what
 * the upload path (Phase 2.3), download path (Phase 2.4), and deletion
 * path (Phase 2.5) need. Originally lived only in apps/api; promoted to a
 * shared package (Phase C, 2026-08-22) once apps/portal-api also needed a
 * binding for tenant-logo upload — the alternative (duplicating ~300 lines
 * of multi-cloud provider code per app) was worse than a small new package.
 */
export interface StorageProvider {
  /**
   * `disposition` (Phase C, C1.3) defaults to `'attachment'` when omitted — every existing
   * document-upload call site is unaffected. Only the tenant-logo upload passes `'inline'`, and
   * only because OCI's pre-authenticated requests fix Content-Disposition at upload time (see
   * OciStorageProvider's doc comment) — GCS/S3 instead decide this per download, at signing time,
   * via getSignedDownloadUrl's own `inline` option below.
   */
  putObject(key: string, data: Buffer, opts: { contentType: string; disposition?: 'inline' | 'attachment' }): Promise<void>;

  /**
   * V4 signed URL, single object, 5-minute expiry (ADR-0006). By default forces an attachment
   * download with a generic content-type — the file is never rendered inline, regardless of what
   * it actually is (sec §4.4's XSS-in-untrusted-document-content guard).
   *
   * `inline`+`contentType` (Phase C, C1.3) opts out of that for content that was already validated
   * safe to render at upload time and is *meant* to render inline — currently only the tenant
   * branding logo (magic-byte-sniffed to PNG/JPEG only, which cannot carry executable content the
   * way an arbitrary tenant-uploaded document could). Never pass this for document downloads.
   * On OciStorageProvider specifically, this has no effect — disposition there is fixed by
   * putObject's own `disposition` at upload time, not toggleable per signed URL; see its doc comment.
   */
  getSignedDownloadUrl(key: string, opts: { displayFilename: string; inline?: boolean; contentType?: string }): Promise<SignedDownloadUrl>;

  /** Deletion-verification input (sec §7.3) — never trust a delete succeeded without checking. */
  objectExists(key: string): Promise<boolean>;

  /** Idempotent: deleting an already-absent key is not an error (a retried purge must not fail). */
  deleteObject(key: string): Promise<void>;

  /**
   * Direct server-side byte fetch (document-chat-rag plan §2) — added for the ingestion worker,
   * which needs the actual file bytes to scan/parse, not a client-facing signed URL. No existing
   * call site used this before Phase 3; every prior consumer only ever needed
   * `getSignedDownloadUrl`.
   */
  getObject(key: string): Promise<Buffer>;
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
 * Tenant-branding logo layout (Phase C, C1.3): `tenants/{tenantId}/logo/{contentHash}.{ext}`.
 * Content-addressed (not a fixed name) so a re-upload naturally gets a fresh key — the caller
 * still deletes the previous object explicitly to avoid orphaned storage, this just avoids any
 * caching/overwrite race on the same key.
 */
export function buildTenantLogoObjectKey(tenantId: string, contentHash: string, ext: 'png' | 'jpg'): string {
  return `tenants/${tenantId}/logo/${contentHash}.${ext}`;
}

/** Recovers the real content-type from a key built by buildTenantLogoObjectKey — needed to sign an inline-renderable logo URL (Phase C, C1.3). */
export function inferTenantLogoContentType(objectKey: string): string {
  return objectKey.endsWith('.jpg') ? MIME_TYPES.jpg : MIME_TYPES.png;
}

/**
 * Dev/test binding — an in-memory map standing in for the `kms-{env}-data`
 * bucket (ADR-0006). Never durable, never shared across processes; the
 * production binding is GcsStorageProvider once infra/ is applied.
 */
export class FakeStorageProvider implements StorageProvider {
  private readonly objects = new Map<string, { data: Buffer; contentType: string; disposition: 'inline' | 'attachment' }>();

  async putObject(key: string, data: Buffer, opts: { contentType: string; disposition?: 'inline' | 'attachment' }): Promise<void> {
    this.objects.set(key, { data, contentType: opts.contentType, disposition: opts.disposition ?? 'attachment' });
  }

  /**
   * Unlike real GCS (which signs a URL without checking the object exists —
   * failure surfaces only when the client fetches it), the fake checks
   * existence at signing time. Deliberate divergence: it turns a
   * wrong-key bug into an immediate, clear test failure instead of a URL
   * nobody ever notices was dead.
   */
  async getSignedDownloadUrl(key: string, opts: { displayFilename: string; inline?: boolean; contentType?: string }): Promise<SignedDownloadUrl> {
    if (!this.objects.has(key)) throw new Error(`FakeStorageProvider: no object at key "${key}"`);
    const disposition = opts.inline ? 'inline' : 'attachment';
    const contentType = opts.inline ? opts.contentType ?? 'application/octet-stream' : 'application/octet-stream';
    return {
      url: `fake://storage/${key}?filename=${encodeURIComponent(opts.displayFilename)}&disposition=${disposition}&contentType=${encodeURIComponent(contentType)}`,
      expiresAt: new Date(Date.now() + SIGNED_URL_TTL_MS),
    };
  }

  async objectExists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async getObject(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    if (!object) throw new Error(`FakeStorageProvider: no object at key "${key}"`);
    return object.data;
  }

  /** Test-only inspection hook — not part of the StorageProvider contract. */
  peek(key: string): { data: Buffer; contentType: string; disposition: 'inline' | 'attachment' } | undefined {
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
    // disposition is ignored here — GCS decides it per download, at signing time, in getSignedDownloadUrl below.
    await this.bucket.file(key).save(data, { contentType: opts.contentType, resumable: false });
  }

  async getSignedDownloadUrl(key: string, opts: { displayFilename: string; inline?: boolean; contentType?: string }): Promise<SignedDownloadUrl> {
    const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_MS);
    const dispositionType = opts.inline ? 'inline' : 'attachment';
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expiresAt,
      responseType: opts.inline ? opts.contentType ?? 'application/octet-stream' : 'application/octet-stream',
      responseDisposition: `${dispositionType}; filename*=${encodeRfc5987Filename(opts.displayFilename)}`,
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

  async getObject(key: string): Promise<Buffer> {
    const [data] = await this.bucket.file(key).download();
    return data;
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
 * caller-supplied display filename, and — Phase C — inline vs. attachment) can be set on every
 * download. OCI pre-authenticated requests (PARs) have no equivalent — Content-Disposition can
 * only be set as object metadata *at upload time* (`putObject`'s `disposition` option) and is then
 * fixed for the object's lifetime. Two consequences: `getSignedDownloadUrl`'s `inline`/`contentType`
 * options are no-ops here (whatever `putObject` set at upload time wins for every later download),
 * and the caller-supplied `displayFilename` passed to `getSignedDownloadUrl` has no effect on what
 * filename the browser shows, since `StorageProvider.putObject` doesn't receive one either (only
 * `contentType`/`disposition`). Threading the real filename through would require extending
 * `StorageProvider.putObject`'s signature again — deliberately not done here to avoid changing the
 * shared interface for a binding nothing currently deploys against; revisit if/when OCI becomes the
 * actual production target with a real filename-on-download requirement.
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

  async putObject(key: string, data: Buffer, opts: { contentType: string; disposition?: 'inline' | 'attachment' }): Promise<void> {
    await this.client.putObject({
      namespaceName: this.namespace,
      bucketName: this.bucketName,
      objectName: key,
      putObjectBody: data,
      contentLength: data.length,
      contentType: opts.contentType,
      // Generic, filename-less disposition — see class doc comment for why a real per-download
      // filename can't be threaded through here the way GCS's signed URLs support, and why this
      // (not getSignedDownloadUrl's inline option) is what actually controls inline vs. attachment on OCI.
      contentDisposition: opts.disposition ?? 'attachment',
    });
  }

  async getSignedDownloadUrl(key: string, _opts: { displayFilename: string; inline?: boolean; contentType?: string }): Promise<SignedDownloadUrl> {
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

  async getObject(key: string): Promise<Buffer> {
    const response = await this.client.getObject({ namespaceName: this.namespace, bucketName: this.bucketName, objectName: key });
    return streamToBuffer(response.value as unknown as NodeJS.ReadableStream);
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * S3-compatible binding — the portable one (ADR-0015 follow-up). Works against AWS S3, Hetzner
 * Object Storage, OCI Object Storage (via its S3-compatibility endpoint), Cloudflare R2, Backblaze
 * B2, and MinIO, since all of them speak the same API. This is deliberately the storage binding to
 * reach for when portability matters: it makes "which cloud hosts our files" a config change
 * (`S3_ENDPOINT`) rather than a code change, which is exactly what a future AWS/Hetzner migration
 * needs.
 *
 * Notably it does NOT share OciStorageProvider's Content-Disposition limitation. S3 presigned URLs
 * accept `ResponseContentDisposition` at *signing* time, so the caller-supplied display filename is
 * honoured per download — matching GcsStorageProvider's behaviour exactly, and satisfying ADR-0006's
 * "attachment; filename*=..." requirement properly rather than via a generic fallback.
 *
 * Credentials come from the AWS SDK's default provider chain (env vars, shared config file, or an
 * instance/task role) — the same "ambient identity, no static keys in code" pattern as GCS's ADC and
 * OCI's instance principals. Not exercised by any test: like the other production bindings, it needs
 * live credentials this environment doesn't have.
 */
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;

  constructor(
    private readonly bucketName: string,
    opts: { region: string; endpoint?: string; forcePathStyle?: boolean } = { region: 'eu-central-1' },
  ) {
    this.client = new S3Client({
      region: opts.region,
      // Unset for real AWS; set for Hetzner / OCI-compat / R2 / MinIO.
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      // Most non-AWS S3 implementations need path-style addressing rather than virtual-hosted-style.
      ...(opts.forcePathStyle === undefined ? {} : { forcePathStyle: opts.forcePathStyle }),
    });
  }

  async putObject(key: string, data: Buffer, opts: { contentType: string }): Promise<void> {
    // disposition is ignored here — S3 decides it per download, at signing time, in getSignedDownloadUrl below.
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucketName, Key: key, Body: data, ContentType: opts.contentType }),
    );
  }

  async getSignedDownloadUrl(key: string, opts: { displayFilename: string; inline?: boolean; contentType?: string }): Promise<SignedDownloadUrl> {
    const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_MS);
    const dispositionType = opts.inline ? 'inline' : 'attachment';
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        // Forced at signing time — by default the file is never rendered inline regardless of its
        // real type (sec §4.4); `inline` opts a specific, already-validated-safe key out of that
        // (see the interface doc comment). The untrusted display name is RFC 5987-encoded, never
        // interpolated raw, either way.
        ResponseContentDisposition: `${dispositionType}; filename*=${encodeRfc5987Filename(opts.displayFilename)}`,
        ResponseContentType: opts.inline ? opts.contentType ?? 'application/octet-stream' : 'application/octet-stream',
      }),
      { expiresIn: SIGNED_URL_TTL_MS / 1000 }, // seconds, unlike the ms used everywhere else here
    );
    return { url, expiresAt };
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
      return true;
    } catch (err) {
      // S3 signals a missing key as NotFound/404. Checked both ways: some S3-compatible
      // implementations set the error name differently than AWS does, but all set the status code.
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 404 || (err as { name?: string })?.name === 'NotFound') return false;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    // S3's DeleteObject is already idempotent — deleting an absent key succeeds — so unlike the GCS
    // and OCI bindings this needs no explicit not-found handling for a retried purge to be safe.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }));
  }

  async getObject(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucketName, Key: key }));
    return streamToBuffer(response.Body as unknown as NodeJS.ReadableStream);
  }
}
