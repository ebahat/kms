export interface PurgeStorageDeps {
  objectExists(key: string): Promise<boolean>;
  deleteObject(key: string): Promise<void>;
}

export interface PurgeResult {
  objectKeysChecked: string[];
  objectKeysStillPresent: string[];
  passed: boolean;
  notes: string[];
}

const DEFERRED_CHECKS_NOTE =
  'chunk/search-index checks deferred — no chunks collection or search index exists yet (Phase 3/4)';

/**
 * Deletes every recorded object key, then re-checks each one (sec §7.3:
 * deletion is verified, not assumed — never trust a delete call succeeded
 * without checking). `deleteObject` is idempotent, so this is safe to
 * re-run on a previously-purged (or partially-purged) entry.
 */
export async function purgeEntryObjects(objectKeys: string[], storage: PurgeStorageDeps): Promise<PurgeResult> {
  for (const key of objectKeys) {
    await storage.deleteObject(key);
  }

  const stillPresent: string[] = [];
  for (const key of objectKeys) {
    if (await storage.objectExists(key)) stillPresent.push(key);
  }

  return {
    objectKeysChecked: objectKeys,
    objectKeysStillPresent: stillPresent,
    passed: stillPresent.length === 0,
    notes: [DEFERRED_CHECKS_NOTE],
  };
}

export interface DueRecycleBinEntry {
  id: string;
  objectKeys: string[];
}

export interface RecycleBinPurgeDeps {
  findDueEntries(now: Date): Promise<DueRecycleBinEntry[]>;
  storage: PurgeStorageDeps;
  recordVerification(entryId: string, result: PurgeResult): Promise<void>;
  markPurged(entryId: string): Promise<void>;
}

/**
 * Batch purge sweep — unwired to any scheduler yet (Phase 3/6 follow-up per
 * the phase-2 plan's own design decision: apps/worker has no purge pool,
 * and cron wiring is infra this phase doesn't need to invent). All I/O is
 * injected so this is fully unit-testable without Mongo/CLS/a real
 * scheduler; a future worker job supplies real implementations of each dep.
 */
export async function runRecycleBinPurge(now: Date, deps: RecycleBinPurgeDeps): Promise<PurgeResult[]> {
  const due = await deps.findDueEntries(now);
  const results: PurgeResult[] = [];

  for (const entry of due) {
    const result = await purgeEntryObjects(entry.objectKeys, deps.storage);
    await deps.recordVerification(entry.id, result);
    if (result.passed) await deps.markPurged(entry.id);
    results.push(result);
  }

  return results;
}
