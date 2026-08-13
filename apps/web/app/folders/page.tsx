'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, apiErrorMessage } from '../../lib/api';
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

  if (!session) return <main style={{ padding: '2rem' }}>טוען...</main>;

  return (
    <main style={{ padding: '2rem' }}>
      <nav style={{ marginBottom: '1rem' }}>
        <Link href="/home">בית</Link>
      </nav>
      <h1>תיקיות</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {session.role === 'admin' && (
        <div style={{ display: 'flex', gap: '0.5rem', margin: '1rem 0' }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="שם תיקיית שורש חדשה" />
          <button onClick={onCreate} disabled={creating || !newName.trim()}>
            צור תיקייה
          </button>
        </div>
      )}

      {folders === null ? (
        <p>טוען...</p>
      ) : folders.length === 0 ? (
        <p>אין תיקיות זמינות.</p>
      ) : (
        <ul>
          {folders.map((f) => (
            <li key={f.id}>
              <Link href={`/folders/${f.id}`}>{f.name}</Link>
              {f.isPublic && <span style={{ marginInlineStart: '0.5rem' }}>(ציבורי)</span>}
              {f.broaderThanParent && (
                <span title={f.addedGroups.join(', ')} style={{ marginInlineStart: '0.5rem', color: 'darkorange' }}>
                  ⚠ הרשאות מורחבות
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
