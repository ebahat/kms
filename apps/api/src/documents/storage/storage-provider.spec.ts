import { buildVersionObjectKey, FakeStorageProvider } from './storage-provider';

describe('buildVersionObjectKey (ADR-0006 bucket layout)', () => {
  it('builds a key containing only server-generated ids, never a filename', () => {
    expect(buildVersionObjectKey('tenant-1', 'version-1')).toBe('tenants/tenant-1/versions/version-1');
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
});
