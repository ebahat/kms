import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  buildTenantLogoObjectKey,
  buildVersionObjectKey,
  encodeRfc5987Filename,
  FakeStorageProvider,
  FsStorageProvider,
  inferTenantLogoContentType,
  SIGNED_URL_TTL_MS,
} from './storage-provider';

describe('buildVersionObjectKey (ADR-0006 bucket layout)', () => {
  it('builds a key containing only server-generated ids, never a filename', () => {
    expect(buildVersionObjectKey('tenant-1', 'version-1')).toBe('tenants/tenant-1/versions/version-1');
  });
});

describe('buildTenantLogoObjectKey (Phase C, C1.3)', () => {
  it('builds a content-addressed key under the tenant logo namespace', () => {
    expect(buildTenantLogoObjectKey('tenant-1', 'abc123', 'png')).toBe('tenants/tenant-1/logo/abc123.png');
  });
});

describe('inferTenantLogoContentType (Phase C, C1.3)', () => {
  it('recovers image/png from a .png key', () => {
    expect(inferTenantLogoContentType('tenants/t1/logo/abc.png')).toBe('image/png');
  });

  it('recovers image/jpeg from a .jpg key', () => {
    expect(inferTenantLogoContentType('tenants/t1/logo/abc.jpg')).toBe('image/jpeg');
  });
});

describe('encodeRfc5987Filename', () => {
  it("percent-encodes a Hebrew filename under the UTF-8'' prefix", () => {
    expect(encodeRfc5987Filename('דוח.pdf')).toBe(`UTF-8''${encodeURIComponent('דוח.pdf')}`);
  });

  it('percent-encodes header-breaking characters like quotes and newlines', () => {
    const malicious = 'x"; evil=1\r\nX-Injected: yes';
    const encoded = encodeRfc5987Filename(malicious);
    expect(encoded).not.toContain('"');
    expect(encoded).not.toContain('\r');
    expect(encoded).not.toContain('\n');
  });
});

describe('FakeStorageProvider', () => {
  it('round-trips a stored object', async () => {
    const storage = new FakeStorageProvider();
    const data = Buffer.from('hello');
    await storage.putObject('tenants/t1/versions/v1', data, { contentType: 'application/pdf' });

    expect(storage.peek('tenants/t1/versions/v1')).toEqual({ data, contentType: 'application/pdf', disposition: 'attachment' });
  });

  it('has nothing stored under a key that was never written', () => {
    const storage = new FakeStorageProvider();
    expect(storage.peek('nonexistent')).toBeUndefined();
  });

  it('putObject defaults disposition to attachment when not specified (documents, sec §4.4)', async () => {
    const storage = new FakeStorageProvider();
    await storage.putObject('k1', Buffer.from('x'), { contentType: 'application/pdf' });
    expect(storage.peek('k1')?.disposition).toBe('attachment');
  });

  it('putObject stores an explicit inline disposition (Phase C, C1.3 tenant logo)', async () => {
    const storage = new FakeStorageProvider();
    await storage.putObject('k1', Buffer.from('x'), { contentType: 'image/png', disposition: 'inline' });
    expect(storage.peek('k1')?.disposition).toBe('inline');
  });

  describe('getObject (document-chat-rag plan §2 — the worker\'s direct byte-fetch path)', () => {
    it('returns the exact bytes previously written', async () => {
      const storage = new FakeStorageProvider();
      const data = Buffer.from('%PDF-1.4 real bytes');
      await storage.putObject('k1', data, { contentType: 'application/pdf' });

      await expect(storage.getObject('k1')).resolves.toEqual(data);
    });

    it('throws for a key that was never written', async () => {
      const storage = new FakeStorageProvider();
      await expect(storage.getObject('missing')).rejects.toThrow();
    });
  });

  describe('getSignedDownloadUrl', () => {
    it('returns a url and an expiry SIGNED_URL_TTL_MS in the future', async () => {
      const storage = new FakeStorageProvider();
      await storage.putObject('tenants/t1/versions/v1', Buffer.from('hello'), { contentType: 'application/pdf' });

      const before = Date.now();
      const result = await storage.getSignedDownloadUrl('tenants/t1/versions/v1', { displayFilename: 'report.pdf' });

      expect(result.url).toContain('tenants/t1/versions/v1');
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + SIGNED_URL_TTL_MS);
    });

    it('defaults to attachment/octet-stream when inline is not requested (sec §4.4 — documents never render inline)', async () => {
      const storage = new FakeStorageProvider();
      await storage.putObject('doc1', Buffer.from('hello'), { contentType: 'application/pdf' });
      const result = await storage.getSignedDownloadUrl('doc1', { displayFilename: 'report.pdf' });
      expect(result.url).toContain('disposition=attachment');
      expect(result.url).toContain(encodeURIComponent('application/octet-stream'));
    });

    it('honors inline+contentType for content already validated safe to render (Phase C, C1.3 tenant logo)', async () => {
      const storage = new FakeStorageProvider();
      await storage.putObject('logo1', Buffer.from('png-bytes'), { contentType: 'image/png', disposition: 'inline' });
      const result = await storage.getSignedDownloadUrl('logo1', { displayFilename: 'logo', inline: true, contentType: 'image/png' });
      expect(result.url).toContain('disposition=inline');
      expect(result.url).toContain(encodeURIComponent('image/png'));
    });

    it('rejects a key that was never written to storage', async () => {
      const storage = new FakeStorageProvider();
      await expect(storage.getSignedDownloadUrl('nonexistent', { displayFilename: 'x.pdf' })).rejects.toThrow();
    });
  });

  describe('objectExists / deleteObject (Phase 2.5)', () => {
    it('objectExists is true after putObject and false before it', async () => {
      const storage = new FakeStorageProvider();
      expect(await storage.objectExists('k1')).toBe(false);
      await storage.putObject('k1', Buffer.from('x'), { contentType: 'application/pdf' });
      expect(await storage.objectExists('k1')).toBe(true);
    });

    it('deleteObject removes the object, and objectExists reflects that', async () => {
      const storage = new FakeStorageProvider();
      await storage.putObject('k1', Buffer.from('x'), { contentType: 'application/pdf' });
      await storage.deleteObject('k1');
      expect(await storage.objectExists('k1')).toBe(false);
    });

    it('deleteObject on a key that was never written is not an error (idempotent, for a retried purge)', async () => {
      const storage = new FakeStorageProvider();
      await expect(storage.deleteObject('nonexistent')).resolves.toBeUndefined();
    });
  });
});

describe('FsStorageProvider (2026-08-29 — real files on disk, so a separate apps/worker process can read what apps/api wrote)', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-storage-provider-spec-'));
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('round-trips a stored object through getObject', async () => {
    const storage = new FsStorageProvider(baseDir);
    const data = Buffer.from('%PDF-1.4 real bytes');
    await storage.putObject('tenants/t1/versions/v1', data, { contentType: 'application/pdf' });

    await expect(storage.getObject('tenants/t1/versions/v1')).resolves.toEqual(data);
  });

  it('is readable by a second, independent FsStorageProvider instance pointed at the same directory — the exact cross-process scenario this binding exists for', async () => {
    const writer = new FsStorageProvider(baseDir);
    const data = Buffer.from('shared across processes');
    await writer.putObject('k1', data, { contentType: 'application/pdf' });

    const reader = new FsStorageProvider(baseDir);
    await expect(reader.getObject('k1')).resolves.toEqual(data);
  });

  it('creates nested directories for a namespaced key', async () => {
    const storage = new FsStorageProvider(baseDir);
    await expect(storage.putObject('tenants/t1/versions/v1', Buffer.from('x'), { contentType: 'application/pdf' })).resolves.toBeUndefined();
  });

  it('throws for a key that was never written', async () => {
    const storage = new FsStorageProvider(baseDir);
    await expect(storage.getObject('missing')).rejects.toThrow();
  });

  describe('objectExists / deleteObject', () => {
    it('objectExists is true after putObject and false before it', async () => {
      const storage = new FsStorageProvider(baseDir);
      expect(await storage.objectExists('k1')).toBe(false);
      await storage.putObject('k1', Buffer.from('x'), { contentType: 'application/pdf' });
      expect(await storage.objectExists('k1')).toBe(true);
    });

    it('deleteObject removes the object, and objectExists reflects that', async () => {
      const storage = new FsStorageProvider(baseDir);
      await storage.putObject('k1', Buffer.from('x'), { contentType: 'application/pdf' });
      await storage.deleteObject('k1');
      expect(await storage.objectExists('k1')).toBe(false);
    });

    it('deleteObject on a key that was never written is not an error (idempotent, for a retried purge)', async () => {
      const storage = new FsStorageProvider(baseDir);
      await expect(storage.deleteObject('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('getSignedDownloadUrl', () => {
    it('returns a url and an expiry SIGNED_URL_TTL_MS in the future', async () => {
      const storage = new FsStorageProvider(baseDir);
      await storage.putObject('tenants/t1/versions/v1', Buffer.from('hello'), { contentType: 'application/pdf' });

      const before = Date.now();
      const result = await storage.getSignedDownloadUrl('tenants/t1/versions/v1', { displayFilename: 'report.pdf' });

      expect(result.url).toContain('tenants/t1/versions/v1');
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + SIGNED_URL_TTL_MS);
    });

    it('rejects a key that was never written to storage', async () => {
      const storage = new FsStorageProvider(baseDir);
      await expect(storage.getSignedDownloadUrl('nonexistent', { displayFilename: 'x.pdf' })).rejects.toThrow();
    });
  });
});
