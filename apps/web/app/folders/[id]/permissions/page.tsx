'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ApiError, apiErrorMessage } from '../../../../lib/api';
import { EffectivePermission, FolderDetail, FolderGrant, foldersApi } from '../../../../lib/folders-api';
import { useSession } from '../../../../lib/use-session';

const TIER_LABEL: Record<string, string> = { read: 'צפייה', edit: 'עריכה', manage: 'ניהול' };

/** UI spec C3 — manage-tier only. No user/group search picker exists yet (C1/C2 aren't searchable directories), so grant-add uses a raw id field — a known MVP gap, not hidden. */
export default function FolderPermissionsPage() {
  const params = useParams<{ id: string }>();
  const folderId = params.id;
  const session = useSession();

  const [folder, setFolder] = useState<FolderDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [principalType, setPrincipalType] = useState<'user' | 'group'>('user');
  const [principalId, setPrincipalId] = useState('');
  const [access, setAccess] = useState<'read' | 'edit' | 'manage'>('read');

  const [previewUserId, setPreviewUserId] = useState('');
  const [preview, setPreview] = useState<EffectivePermission | null>(null);

  const load = useCallback(async () => {
    setNotFound(false);
    setError(null);
    try {
      const f = await foldersApi.detail(folderId);
      setFolder(f);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(apiErrorMessage(e, 'שגיאה בטעינת הרשאות התיקייה'));
    }
  }, [folderId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onAddGrant() {
    if (!principalId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await foldersApi.addGrant(folderId, { principalType, principalId: principalId.trim(), access });
      setPrincipalId('');
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'הוספת ההרשאה נכשלה'));
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(grant: FolderGrant) {
    setBusy(true);
    setError(null);
    try {
      await foldersApi.revokeGrant(folderId, grant.principalType, grant.principalId);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'ביטול ההרשאה נכשל'));
    } finally {
      setBusy(false);
    }
  }

  async function onTogglePublic() {
    if (!folder) return;
    setBusy(true);
    setError(null);
    try {
      await foldersApi.setPublic(folderId, !folder.isPublic);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'עדכון הנגישות הציבורית נכשל'));
    } finally {
      setBusy(false);
    }
  }

  async function onResetToInherited() {
    if (!window.confirm('לאפס את ההרשאות ולחזור לירושה מתיקיית האב?')) return;
    setBusy(true);
    setError(null);
    try {
      await foldersApi.resetToInherited(folderId);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'האיפוס נכשל'));
    } finally {
      setBusy(false);
    }
  }

  async function onPreview() {
    if (!previewUserId.trim()) return;
    setError(null);
    try {
      const result = await foldersApi.effectivePermission(folderId, previewUserId.trim());
      setPreview(result);
    } catch (e) {
      setError(apiErrorMessage(e, 'תצוגת ההרשאה האפקטיבית נכשלה'));
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
  if (!folder) return <main style={{ padding: '2rem' }}>טוען...</main>;

  if (folder.tier !== 'manage') {
    return (
      <main style={{ padding: '2rem' }}>
        <p>נדרשת הרשאת ניהול לתיקייה זו כדי לצפות בהרשאות שלה.</p>
        <Link href={`/folders/${folderId}`}>חזרה לתיקייה</Link>
      </main>
    );
  }

  return (
    <main style={{ padding: '2rem' }}>
      <nav style={{ marginBottom: '1rem' }}>
        <Link href={`/folders/${folderId}`}>{folder.name}</Link> / הרשאות
      </nav>
      <h1>הרשאות עבור {folder.name}</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <section style={{ margin: '1rem 0' }}>
        <label>
          <input type="checkbox" checked={folder.isPublic} onChange={onTogglePublic} disabled={busy} /> ציבורי (נגיש לכל
          המשתמשים בארגון)
        </label>
        {folder.hasExplicitGrants && (
          <div>
            <button onClick={onResetToInherited} disabled={busy}>
              אפס לירושה מתיקיית האב
            </button>
          </div>
        )}
      </section>

      <h2>הרשאות מוגדרות</h2>
      {!folder.grants || folder.grants.length === 0 ? (
        <p>{folder.hasExplicitGrants ? 'אין הרשאות מוגדרות מפורשות.' : 'התיקייה יורשת הרשאות מתיקיית האב.'}</p>
      ) : (
        <ul>
          {folder.grants.map((g) => (
            <li key={`${g.principalType}:${g.principalId}`}>
              {g.principalType === 'user' ? 'משתמש' : 'קבוצה'} {g.principalId} — {TIER_LABEL[g.access]}{' '}
              <button onClick={() => onRevoke(g)} disabled={busy}>
                בטל
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>הוסף הרשאה</h3>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <select value={principalType} onChange={(e) => setPrincipalType(e.target.value as 'user' | 'group')}>
          <option value="user">משתמש</option>
          <option value="group">קבוצה</option>
        </select>
        <input value={principalId} onChange={(e) => setPrincipalId(e.target.value)} placeholder="מזהה" />
        <select value={access} onChange={(e) => setAccess(e.target.value as 'read' | 'edit' | 'manage')}>
          <option value="read">צפייה</option>
          <option value="edit">עריכה</option>
          <option value="manage">ניהול</option>
        </select>
        <button onClick={onAddGrant} disabled={busy || !principalId.trim()}>
          הוסף
        </button>
      </div>

      <h2>למה משתמש X רואה את התיקייה הזו?</h2>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input value={previewUserId} onChange={(e) => setPreviewUserId(e.target.value)} placeholder="מזהה משתמש" />
        <button onClick={onPreview} disabled={!previewUserId.trim()}>
          בדוק
        </button>
      </div>
      {preview && (
        <p>
          {preview.tier === null
            ? 'למשתמש זה אין גישה לתיקייה.'
            : `רמת גישה: ${TIER_LABEL[preview.tier]}, בזכות ${
                preview.decidingGrant?.via === 'public'
                  ? 'הגדרת "ציבורי"'
                  : preview.decidingGrant
                    ? `${preview.decidingGrant.via.principalType === 'user' ? 'הרשאה אישית' : 'חברות בקבוצה'} (${preview.decidingGrant.via.principalId})`
                    : 'לא ידוע'
              }`}
        </p>
      )}
      <p style={{ fontSize: '0.85rem', color: '#666' }}>
        הערה: אם המשתמש הנבדק הוא עצמו מנהל מערכת, תצוגה זו אינה משקפת את הגישה המלאה שלו (מנהלים עוקפים הרשאות תיקיות).
      </p>
    </main>
  );
}
