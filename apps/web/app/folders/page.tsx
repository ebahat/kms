'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../components/app-shell';
import { apiErrorMessage } from '../../lib/api';
import { FolderSummary, foldersApi } from '../../lib/folders-api';
import { useSession } from '../../lib/use-session';

/** UI spec B2's folder-tree portion, root level (no parentId). Document listing/upload lives one level down at /folders/[id] (B4/B5 remain out of scope, per the Phase 2 UI plan). */
export default function FoldersRootPage() {
  const session = useSession();
  const router = useRouter();
  const [folders, setFolders] = useState<FolderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    foldersApi
      .list()
      .then(setFolders)
      .catch((e) => setError(apiErrorMessage(e, 'שגיאה בטעינת התיקיות')));
  }, []);

  async function onCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await foldersApi.create({ parentId: null, name: newName.trim() });
      setNewName('');
      router.push(`/folders/${created.id}`);
    } catch (e) {
      setError(apiErrorMessage(e, 'יצירת התיקייה נכשלה'));
    } finally {
      setCreating(false);
    }
  }

  if (!session) return <div className="min-h-screen bg-background" />;

  return (
    <AppShell session={session} active="folders">
      <div className="flex justify-between items-end pb-4 border-b border-outline-variant mb-6">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-surface">תיקיות</h2>
        </div>
        {session.role === 'admin' && (
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="שם תיקיית שורש חדשה"
              className="px-3 py-2 border border-outline-variant rounded-DEFAULT text-body-sm font-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={onCreate}
              disabled={creating || !newName.trim()}
              className="bg-primary text-on-primary-dynamic font-title-sm text-title-sm py-2 px-4 rounded-DEFAULT flex items-center gap-2 hover:bg-primary-container hover:text-on-primary-container transition-colors disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              צור תיקייה
            </button>
          </div>
        )}
      </div>

      {error && <p className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{error}</p>}

      {folders === null ? (
        <p className="font-body-md text-body-md text-on-surface-variant">טוען...</p>
      ) : folders.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">אין תיקיות זמינות.</p>
      ) : (
        <div className="bg-surface-container-lowest rounded-lg border border-outline-variant divide-y divide-outline-variant overflow-hidden shadow-sm">
          {folders.map((f) => (
            <Link
              key={f.id}
              href={`/folders/${f.id}`}
              className="flex items-center gap-3 px-4 h-row-height-standard hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-tertiary-container" style={{ fontVariationSettings: "'FILL' 1" }}>
                folder
              </span>
              <span className="font-body-md text-body-md text-on-surface">{f.name}</span>
              {f.isPublic && (
                <span className="font-label-xs text-label-xs bg-surface-variant text-on-surface-variant px-2 py-0.5 rounded-full">ציבורי</span>
              )}
              {f.broaderThanParent && (
                <span
                  title={f.addedGroups.join(', ')}
                  className="font-label-xs text-label-xs bg-error-container text-on-error-container px-2 py-0.5 rounded-full flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">warning</span>
                  הרשאות מורחבות
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
