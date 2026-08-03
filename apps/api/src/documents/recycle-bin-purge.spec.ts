import { purgeEntryObjects, runRecycleBinPurge } from './recycle-bin-purge';

function makeFakeStorage(initiallyPresent: string[]) {
  const objects = new Set(initiallyPresent);
  return {
    objectExists: jest.fn(async (key: string) => objects.has(key)),
    deleteObject: jest.fn(async (key: string) => {
      objects.delete(key);
    }),
  };
}

describe('purgeEntryObjects (sec §7.3 — deletion is verified, not assumed)', () => {
  it('deletes every key and reports passed: true when none remain', async () => {
    const storage = makeFakeStorage(['k1', 'k2']);
    const result = await purgeEntryObjects(['k1', 'k2'], storage);

    expect(storage.deleteObject).toHaveBeenCalledWith('k1');
    expect(storage.deleteObject).toHaveBeenCalledWith('k2');
    expect(result).toEqual({
      objectKeysChecked: ['k1', 'k2'],
      objectKeysStillPresent: [],
      passed: true,
      notes: [expect.stringContaining('chunk/search-index checks deferred')],
    });
  });

  it('reports passed: false and lists exactly the keys still present when delete does not actually remove one', async () => {
    const storage = makeFakeStorage(['k1']);
    storage.deleteObject.mockImplementation(async () => {}); // simulates a delete call that silently no-ops
    const result = await purgeEntryObjects(['k1'], storage);

    expect(result.passed).toBe(false);
    expect(result.objectKeysStillPresent).toEqual(['k1']);
  });

  it('is safe to call again on an already-purged entry (idempotent deleteObject, empty result)', async () => {
    const storage = makeFakeStorage([]);
    const result = await purgeEntryObjects(['k1'], storage);
    expect(result.passed).toBe(true);
  });

  it('handles an entry with zero object keys (defensive, should not happen but must not crash)', async () => {
    const storage = makeFakeStorage([]);
    const result = await purgeEntryObjects([], storage);
    expect(result).toEqual({ objectKeysChecked: [], objectKeysStillPresent: [], passed: true, notes: expect.any(Array) });
  });
});

describe('runRecycleBinPurge (batch sweep, unwired to a scheduler — Phase 3/6 follow-up)', () => {
  it('purges every due entry, records a verification, and marks it purged when verification passes', async () => {
    const storage = makeFakeStorage(['k1', 'k2']);
    const recordVerification = jest.fn().mockResolvedValue(undefined);
    const markPurged = jest.fn().mockResolvedValue(undefined);
    const findDueEntries = jest.fn().mockResolvedValue([
      { id: 'entry-1', objectKeys: ['k1'] },
      { id: 'entry-2', objectKeys: ['k2'] },
    ]);

    const results = await runRecycleBinPurge(new Date(), { findDueEntries, storage, recordVerification, markPurged });

    expect(results).toHaveLength(2);
    expect(recordVerification).toHaveBeenCalledWith('entry-1', expect.objectContaining({ passed: true }));
    expect(recordVerification).toHaveBeenCalledWith('entry-2', expect.objectContaining({ passed: true }));
    expect(markPurged).toHaveBeenCalledWith('entry-1');
    expect(markPurged).toHaveBeenCalledWith('entry-2');
  });

  it('does not mark an entry purged when its verification fails', async () => {
    // objectExists always true simulates a delete call that silently no-ops.
    const storage = { objectExists: jest.fn(async () => true), deleteObject: jest.fn(async () => undefined) };
    const recordVerification = jest.fn().mockResolvedValue(undefined);
    const markPurged = jest.fn().mockResolvedValue(undefined);
    const findDueEntries = jest.fn().mockResolvedValue([{ id: 'entry-1', objectKeys: ['k1'] }]);

    await runRecycleBinPurge(new Date(), { findDueEntries, storage, recordVerification, markPurged });

    expect(recordVerification).toHaveBeenCalledWith('entry-1', expect.objectContaining({ passed: false }));
    expect(markPurged).not.toHaveBeenCalled();
  });

  it('does nothing when there are no due entries', async () => {
    const storage = makeFakeStorage([]);
    const recordVerification = jest.fn();
    const markPurged = jest.fn();
    const findDueEntries = jest.fn().mockResolvedValue([]);

    const results = await runRecycleBinPurge(new Date(), { findDueEntries, storage, recordVerification, markPurged });

    expect(results).toEqual([]);
    expect(recordVerification).not.toHaveBeenCalled();
    expect(markPurged).not.toHaveBeenCalled();
  });
});
