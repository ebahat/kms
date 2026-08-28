'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import { apiErrorMessage } from '../../lib/api';
import { RecycleBinEntry, recycleBinApi } from '../../lib/recycle-bin-api';
import { useSession } from '../../lib/use-session';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysRemaining(purgeAfter: string): number {
  return Math.max(0, Math.ceil((new Date(purgeAfter).getTime() - Date.now()) / MS_PER_DAY));
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL');
}

/**
 * UI spec C4 — admin-only (matches the backend's list/restore/purge guards). Purge uses a
 * typed-confirmation dialog (type "DELETE"), matching the mockup's own choice: this is the most
 * destructive action in the product, so a plain Yes/No isn't enough. The mockup's "רוקן סל מיחזור"
 * bulk-empty button isn't built here — no batch-purge endpoint exists, and faking one client-side
 * (loop over every entry's own purge call) would have different failure/atomicity semantics than
 * a real bulk action without ever being asked for; per-entry purge already covers the real need.
 */
export default function RecycleBinPage() {
  const session = useSession();
  const [entries, setEntries] = useState<RecycleBinEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<RecycleBinEntry | null>(null);
  const [confirmText, setConfirmText] = useState('');

  async function load() {
    try {
      setEntries(await recycleBinApi.list());
    } catch (e) {
      setError(apiErrorMessage(e, 'שגיאה בטעינת סל המיחזור'));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onRestore(entry: RecycleBinEntry) {
    setBusyId(entry.id);
    setError(null);
    try {
      await recycleBinApi.restore(entry.id);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'השחזור נכשל'));
    } finally {
      setBusyId(null);
    }
  }

  async function onConfirmPurge() {
    if (!purgeTarget || confirmText !== 'DELETE') return;
    setBusyId(purgeTarget.id);
    setError(null);
    try {
      await recycleBinApi.purge(purgeTarget.id);
      setPurgeTarget(null);
      setConfirmText('');
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'המחיקה הסופית נכשלה'));
    } finally {
      setBusyId(null);
    }
  }

  if (!session) return <div className="min-h-screen bg-background" />;

  return (
    <AppShell session={session} active="admin">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-end mb-6">
          <div>
            <h2 className="font-display-lg text-display-lg text-on-background">סל המיחזור</h2>
            <p className="font-body-md text-body-md text-on-surface-variant mt-2">מסמכים שנמחקו יישמרו כאן עד למחיקה סופית לפי מדיניות השמירה של הארגון.</p>
          </div>
        </div>

        {error && <p className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{error}</p>}

        {entries === null ? (
          <p className="font-body-md text-body-md text-on-surface-variant">טוען...</p>
        ) : entries.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">סל המיחזור ריק.</p>
        ) : (
          <div className="bg-surface-container-low rounded-xl border border-outline-variant overflow-hidden shadow-sm">
            <div className="grid grid-cols-12 gap-4 p-4 border-b border-outline-variant bg-surface-container font-label-xs text-label-xs text-on-surface-variant">
              <div className="col-span-4">שם מסמך</div>
              <div className="col-span-3">מיקום מקורי</div>
              <div className="col-span-2">תאריך מחיקה</div>
              <div className="col-span-3 text-left">פעולות</div>
            </div>
            <div className="flex flex-col">
              {entries.map((entry) => {
                const remaining = daysRemaining(entry.purgeAfter);
                return (
                  <div key={entry.id} className="grid grid-cols-12 gap-4 p-4 items-center border-b border-outline-variant last:border-b-0 hover:bg-surface-container-high transition-colors">
                    <div className="col-span-4 flex items-center gap-3 min-w-0">
                      <span className="material-symbols-outlined text-on-surface-variant shrink-0">description</span>
                      <span className="font-body-sm text-body-sm text-on-surface font-medium truncate">{entry.name}</span>
                    </div>
                    <div className="col-span-3 text-on-surface-variant font-body-sm text-body-sm truncate">{entry.folderName ?? '—'}</div>
                    <div className="col-span-2 flex flex-col">
                      <span className="font-body-sm text-body-sm text-on-surface">{formatDate(entry.deletedAt)}</span>
                      <span className={`font-label-xs text-label-xs mt-1 flex items-center gap-1 ${remaining <= 7 ? 'text-error' : 'text-on-surface-variant'}`}>
                        {remaining <= 7 && <span className="material-symbols-outlined text-[14px]">warning</span>}
                        נותרו {remaining} ימים למחיקה סופית
                      </span>
                    </div>
                    <div className="col-span-3 flex justify-end gap-2">
                      <button
                        onClick={() => onRestore(entry)}
                        disabled={busyId === entry.id}
                        className="px-3 py-1.5 bg-secondary-container text-on-secondary-container rounded font-label-xs text-label-xs hover:bg-secondary-fixed-dim transition-colors disabled:opacity-60"
                      >
                        שחזר
                      </button>
                      <button
                        onClick={() => {
                          setPurgeTarget(entry);
                          setConfirmText('');
                        }}
                        disabled={busyId === entry.id}
                        className="px-3 py-1.5 border border-outline-variant text-on-surface-variant rounded font-label-xs text-label-xs hover:bg-error-container hover:text-error hover:border-error transition-colors disabled:opacity-60"
                      >
                        מחק לצמיתות
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {purgeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="bg-surface-container-highest w-full max-w-md rounded-xl shadow-lg border border-outline-variant p-6 m-4">
            <div className="flex items-center gap-3 text-error mb-4">
              <span className="material-symbols-outlined text-[32px]">warning</span>
              <h3 className="font-headline-md text-headline-md text-on-surface">מחיקה לצמיתות</h3>
            </div>
            <p className="font-body-md text-body-md text-on-surface-variant mb-6">
              פעולה זו תמחק לצמיתות את המסמך <strong>&quot;{purgeTarget.name}&quot;</strong>.
              <br />
              לא ניתן יהיה לשחזר מסמך זה לאחר מכן.
            </p>
            <div className="mb-6">
              <label htmlFor="confirm-delete" className="block font-label-xs text-label-xs text-on-surface-variant mb-2">
                כדי לאשר, אנא הקלד &apos;DELETE&apos; בתיבה מטה:
              </label>
              <input
                id="confirm-delete"
                autoComplete="off"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-body-md font-code-sm text-code-sm text-on-surface uppercase focus:border-error focus:ring-1 focus:ring-error outline-none"
                placeholder="DELETE"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setPurgeTarget(null)}
                className="px-4 py-2 border border-outline-variant text-on-surface-variant rounded hover:bg-surface-container-high transition-colors font-title-sm text-title-sm"
              >
                ביטול
              </button>
              <button
                onClick={onConfirmPurge}
                disabled={confirmText !== 'DELETE' || busyId === purgeTarget.id}
                className="px-4 py-2 bg-error text-on-error rounded transition-colors font-title-sm text-title-sm disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:shadow-md"
              >
                מחק לצמיתות
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
