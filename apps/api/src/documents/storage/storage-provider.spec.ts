import { buildVersionObjectKey, encodeRfc5987Filename, FakeStorageProvider, SIGNED_URL_TTL_MS } from './storage-provider';

describe('buildVersionObjectKey (ADR-0006 bucket layout)', () => {
  it('builds a key containing only server-generated ids, never a filename', () => {
    expect(buildVersionObjectKey('tenant-1', 'version-1')).toBe('tenants/tenant-1/versions/version-1');
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

    expect(storage.peek('tenants/t1/versions/v1')).toEqual({ data, contentType: 'application/pdf' });
  });

  it('has nothing stored under a key that was never written', () => {
    const storage = new FakeStorageProvider();
    expect(storage.peek('nonexistent')).toBeUndefined();
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
