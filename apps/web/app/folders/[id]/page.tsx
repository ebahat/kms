'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ApiError, apiErrorMessage } from '../../../lib/api';
import { DocumentSummary, FolderDetail, FolderSummary, foldersApi } from '../../../lib/folders-api';
import { useSession } from '../../../lib/use-session';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** UI spec B2's folder-tree portion, one folder deep: breadcrumb, subfolders, read-only document list. Upload/version history/processing-queue (B3-B5) are out of scope for this plan. */
export default function FolderDetailPage() {
  const params = useParams<{ id: string }>();
  const folderId = params.id;
  const session = useSession();
  const router = useRouter();

  const [folder, setFolder] = useState<FolderDetail | null>(null);
  const [children, setChildren] = useState<FolderSummary[] | null>(null);
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setNotFound(false);
    setError(null);
    try {
      const [f, kids, docs] = await Promise.all([foldersApi.detail(folderId), foldersApi.list(folderId), foldersApi.documents(folderId)]);
      setFolder(f);
      setChildren(kids);
      setDocuments(docs);
      setRenameValue(f.name);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(apiErrorMessage(e, 'שגיאה בטעינת התיקייה'));
    }
  }, [folderId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreateSubfolder() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await foldersApi.create({ parentId: folderId, name: newName.trim() });
      setNewName('');
      router.push(`/folders/${created.id}`);
    } catch (e) {
      setError(apiErrorMessage(e, 'יצירת התיקייה נכשלה'));
    } finally {
      setBusy(false);
    }
  }

  async function onRename() {
    if (!renameValue.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await foldersApi.rename(folderId, renameValue.trim());
      setRenaming(false);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'שינוי השם נכשל'));
    } finally {
      setBusy(false);
    }
  }

  async function onMove() {
    const target = window.prompt('מזהה תיקיית היעד (או השאירו ריק להעברה לשורש) — שים לב: ההעברה תחיל את הרשאות היעד על התיקייה:');
    if (target === null) return;
    setBusy(true);
    setError(null);
    try {
      await foldersApi.move(folderId, target.trim() || null);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'ההעברה נכשלה'));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!window.confirm('למחוק את התיקייה? הפעולה אפשרית רק כשהתיקייה ריקה.')) return;
    setBusy(true);
    setError(null);
    try {
      await foldersApi.remove(folderId);
      router.push(folder?.parentId ? `/folders/${folder.parentId}` : '/folders');
    } catch (e) {
      setError(apiErrorMessage(e, 'המחיקה נכשלה — ודאו שהתיקייה ריקה'));
      setBusy(false);
    }
  }

  if (!session) return <main style={{ padding: '2rem' }}>טוען...</main>;
  if (notFound) {
    return (
      <main style={{ padding: '2rem' }}>
        <p>התיקייה לא נמצאה, או שאין לך הרשאה לצפות בה.</p>
        <Link href="/folders">חזרה לתיקיות</Link>
      </main>
    );
  }
  if (!folder || !children || !documents) return <main style={{ padding: '2rem' }}>טוען...</main>;

  const canEdit = folder.tier === 'edit' || folder.tier === 'manage';
  const canManage = folder.tier === 'manage';

  return (
    <main style={{ padding: '2rem' }}>
      <nav style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Link href="/folders">תיקיות</Link>
        {folder.path.map((ancestor) => (
          <span key={ancestor.id}>
            {' / '}
            <Link href={`/folders/${ancestor.id}`}>{ancestor.name}</Link>
          </span>
        ))}
        {' / '}
        <span>{folder.name}</span>
      </nav>

      <h1>
        {folder.name}
        {folder.isPublic && <span style={{ marginInlineStart: '0.5rem', fontSize: '0.9rem' }}>(ציבורי)</span>}
        {folder.broaderThanParent && (
          <span title={folder.addedGroups.join(', ')} style={{ marginInlineStart: '0.5rem', fontSize: '0.9rem', color: 'darkorange' }}>
            ⚠ הרשאות מורחבות ביחס לתיקיית האב
          </span>
        )}
      </h1>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '0.5rem', margin: '1rem 0', flexWrap: 'wrap' }}>
        {canManage && (
          <>
            {renaming ? (
              <>
                <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
                <button onClick={onRename} disabled={busy}>
                  שמור
                </button>
                <button onClick={() => setRenaming(false)} disabled={busy}>
                  ביטול
                </button>
              </>
            ) : (
              <button onClick={() => setRenaming(true)} disabled={busy}>
                שנה שם
              </button>
            )}
            <button onClick={onMove} disabled={busy}>
              העבר
            </button>
            <button onClick={onDelete} disabled={busy}>
              מחק
            </button>
            <Link href={`/folders/${folderId}/permissions`}>ניהול הרשאות</Link>
          </>
        )}
      </div>

      {canEdit && (
        <div style={{ display: 'flex', gap: '0.5rem', margin: '1rem 0' }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="שם תת-תיקייה חדשה" />
          <button onClick={onCreateSubfolder} disabled={busy || !newName.trim()}>
            צור תת-תיקייה
          </button>
        </div>
      )}

      <h2>תתי-תיקיות</h2>
      {children.length === 0 ? (
        <p>אין תתי-תיקיות.</p>
      ) : (
        <ul>
          {children.map((f) => (
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

      <h2>מסמכים</h2>
      {documents.length === 0 ? (
        <p>אין מסמכים בתיקייה זו.</p>
      ) : (
        <ul>
          {documents.map((d) => (
            <li key={d.id}>
              {d.name} — {formatSize(d.sizeBytes)} — גרסה {d.latestVersionNumber} — {d.status}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
