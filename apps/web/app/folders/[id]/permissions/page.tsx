'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AppShell } from '../../../../components/app-shell';
import { ApiError, apiErrorMessage } from '../../../../lib/api';
import { EffectivePermission, FolderDetail, FolderGrant, foldersApi } from '../../../../lib/folders-api';
import { usersApi } from '../../../../lib/users-api';
import { useSession } from '../../../../lib/use-session';

const TIER_LABEL: Record<string, string> = { read: 'צפייה', edit: 'עריכה', manage: 'ניהול' };

/**
 * UI spec C3 — manage-tier only. Access is a single 3-tier field (read/edit/manage) in the real
 * permission model, shown as a badge rather than the mockup's independent read/edit toggle
 * switches, which don't match this data shape.
 *
 * A user grant is added by email (resolved via `usersApi.lookupByEmail` — 2026-08-28 bug fix: the
 * field used to send whatever was typed straight through as `principalId`, so an admin typing an
 * email got a raw "invalid id" from the backend's ObjectId validation, with no way to discover a
 * user's actual id anywhere in this app). A group grant still takes a raw id — no search picker
 * exists there either, but a group's own id IS at least shown (copyable) on its own detail page
 * (`/groups/[id]`), unlike a user id, which appears nowhere in the UI — a real but smaller gap.
 */
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
    const raw = principalId.trim();
    if (!raw) return;
    setBusy(true);
    setError(null);
    try {
      let resolvedId = raw;
      if (principalType === 'user') {
        const user = await usersApi.lookupByEmail(raw);
        resolvedId = user.id;
      }
      await foldersApi.addGrant(folderId, { principalType, principalId: resolvedId, access });
      setPrincipalId('');
      await load();
    } catch (e) {
      if (principalType === 'user' && e instanceof ApiError && e.status === 404) setError(`לא נמצא משתמש עם האימייל "${raw}"`);
      else setError(apiErrorMessage(e, 'הוספת ההרשאה נכשלה'));
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
    const email = previewUserId.trim();
    if (!email) return;
    setError(null);
    setPreview(null);
    try {
      const user = await usersApi.lookupByEmail(email);
      const result = await foldersApi.effectivePermission(folderId, user.id);
      setPreview(result);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setError(`לא נמצא משתמש עם האימייל "${email}"`);
      else setError(apiErrorMessage(e, 'תצוגת ההרשאה האפקטיבית נכשלה'));
    }
  }

  if (!session) return <div className="min-h-screen bg-background" />;
  if (notFound) {
    return (
      <AppShell session={session} active="folders">
        <p className="font-body-md text-body-md text-on-surface mb-4">התיקייה לא נמצאה, או שאין לך הרשאה לצפות בה.</p>
        <Link href="/folders" className="text-primary hover:underline">
          חזרה לתיקיות
        </Link>
      </AppShell>
    );
  }
  if (!folder) {
    return (
      <AppShell session={session} active="folders">
        <p className="font-body-md text-body-md text-on-surface-variant">טוען...</p>
      </AppShell>
    );
  }

  if (folder.tier !== 'manage') {
    return (
      <AppShell session={session} active="folders">
        <p className="font-body-md text-body-md text-on-surface mb-4">נדרשת הרשאת ניהול לתיקייה זו כדי לצפות בהרשאות שלה.</p>
        <Link href={`/folders/${folderId}`} className="text-primary hover:underline">
          חזרה לתיקייה
        </Link>
      </AppShell>
    );
  }

  return (
    <AppShell session={session} active="folders">
      <nav className="mb-4 font-body-sm text-body-sm text-on-surface-variant">
        <Link href={`/folders/${folderId}`} className="hover:text-primary">
          {folder.name}
        </Link>{' '}
        / הרשאות
      </nav>

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 shadow-sm mb-6">
        <div className="flex justify-between items-start mb-4">
          <h1 className="font-headline-md text-headline-md text-on-surface">הרשאות עבור {folder.name}</h1>
          {folder.hasExplicitGrants && (
            <span className="flex items-center gap-2 bg-error-container text-on-error-container px-3 py-1.5 rounded-full font-label-xs text-label-xs font-bold">
              <span className="material-symbols-outlined text-sm">rule_settings</span>
              הגדרות מותאמות אישית (לא יורש)
            </span>
          )}
        </div>
        <div className="bg-surface-container rounded-lg p-3 flex items-center justify-between">
          <label className="flex items-center gap-3 font-body-sm text-body-sm text-on-surface">
            <input type="checkbox" checked={folder.isPublic} onChange={onTogglePublic} disabled={busy} className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary" />
            ציבורי (נגיש לכל המשתמשים בארגון)
          </label>
          {folder.hasExplicitGrants && (
            <button
              onClick={onResetToInherited}
              disabled={busy}
              className="bg-surface-container-high hover:bg-surface-variant text-on-surface font-label-xs text-label-xs px-3 py-1.5 rounded border border-outline-variant transition-colors"
            >
              אפס לירושה מתיקיית האב
            </button>
          )}
        </div>
      </div>

      {error && <p className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{error}</p>}

      <div className="bg-surface-container-low rounded-xl border border-outline-variant p-6 mb-6">
        <h3 className="font-title-sm text-title-sm text-on-surface font-semibold mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">policy</span>
          בדיקת הרשאות פועל (Effective Permissions)
        </h3>
        <div className="flex items-end gap-4 bg-surface-container-lowest p-4 rounded-lg border border-outline-variant flex-wrap">
          <div className="flex-grow min-w-[200px]">
            <label className="block font-label-xs text-label-xs text-on-surface-variant mb-1">אימייל המשתמש לבדיקה:</label>
            <div className="flex gap-2">
              <input
                value={previewUserId}
                onChange={(e) => setPreviewUserId(e.target.value)}
                placeholder="אימייל המשתמש"
                type="email"
                className="flex-1 px-3 py-2 border border-outline-variant rounded-DEFAULT text-body-sm font-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={onPreview}
                disabled={!previewUserId.trim()}
                className="bg-surface-container-high hover:bg-surface-variant text-on-surface font-label-xs text-label-xs px-3 py-2 rounded border border-outline-variant transition-colors disabled:opacity-60"
              >
                בדוק
              </button>
            </div>
          </div>
          {preview && (
            <div className="flex-grow bg-primary-container/10 border border-primary/20 rounded-lg p-3">
              <p className="font-body-sm text-body-sm text-on-surface flex items-start gap-2">
                <span className="material-symbols-outlined text-primary mt-0.5 text-[18px]">
                  {preview.tier === null ? 'block' : 'check_circle'}
                </span>
                <span>
                  {preview.tier === null
                    ? 'למשתמש זה אין גישה לתיקייה.'
                    : `רמת גישה: ${TIER_LABEL[preview.tier]}, בזכות ${
                        preview.decidingGrant?.via === 'public'
                          ? 'הגדרת "ציבורי"'
                          : preview.decidingGrant
                            ? `${preview.decidingGrant.via.principalType === 'user' ? 'הרשאה אישית' : 'חברות בקבוצה'} (${preview.decidingGrant.via.principalId})`
                            : 'לא ידוע'
                      }`}
                </span>
              </p>
            </div>
          )}
        </div>
        <p className="font-label-xs text-label-xs text-on-surface-variant mt-3">
          הערה: אם המשתמש הנבדק הוא עצמו מנהל מערכת, תצוגה זו אינה משקפת את הגישה המלאה שלו (מנהלים עוקפים הרשאות תיקיות).
        </p>
      </div>

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden shadow-sm">
        <div className="p-4 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h3 className="font-title-sm text-title-sm text-on-surface font-semibold">רשימת הרשאות (ACL)</h3>
        </div>
        {!folder.grants || folder.grants.length === 0 ? (
          <p className="font-body-sm text-body-sm text-on-surface-variant p-4">
            {folder.hasExplicitGrants ? 'אין הרשאות מוגדרות מפורשות.' : 'התיקייה יורשת הרשאות מתיקיית האב.'}
          </p>
        ) : (
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-surface-container border-b border-outline-variant h-row-height-dense">
                <th className="font-label-xs text-label-xs text-on-surface-variant font-medium py-2 px-4">משתמש / קבוצה</th>
                <th className="font-label-xs text-label-xs text-on-surface-variant font-medium py-2 px-4">רמת גישה</th>
                <th className="py-2 px-4 w-12"></th>
              </tr>
            </thead>
            <tbody className="font-body-sm text-body-sm">
              {folder.grants.map((g) => (
                <tr key={`${g.principalType}:${g.principalId}`} className="border-b border-outline-variant hover:bg-surface-container-low transition-colors h-row-height-standard">
                  <td className="py-2 px-4">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-secondary text-[20px]">{g.principalType === 'user' ? 'person' : 'group'}</span>
                      <span className="font-medium text-on-surface">
                        {g.principalType === 'user' ? 'משתמש' : 'קבוצה'} {g.principalId}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 px-4">
                    <span className="inline-flex items-center gap-1 bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded font-label-xs text-label-xs">
                      {TIER_LABEL[g.access]}
                    </span>
                  </td>
                  <td className="py-2 px-4 text-center">
                    <button
                      onClick={() => onRevoke(g)}
                      disabled={busy}
                      className="text-on-surface-variant hover:text-error transition-colors p-1 rounded-full hover:bg-error-container"
                      title="בטל הרשאה"
                      aria-label="בטל הרשאה"
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="p-4 border-t border-outline-variant bg-surface-container-low flex gap-2 items-center flex-wrap">
          <select
            value={principalType}
            onChange={(e) => setPrincipalType(e.target.value as 'user' | 'group')}
            className="bg-surface border border-outline-variant rounded-DEFAULT py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          >
            <option value="user">משתמש</option>
            <option value="group">קבוצה</option>
          </select>
          <input
            value={principalId}
            onChange={(e) => setPrincipalId(e.target.value)}
            placeholder={principalType === 'user' ? 'אימייל המשתמש' : 'מזהה קבוצה'}
            type={principalType === 'user' ? 'email' : 'text'}
            className="flex-1 min-w-[150px] px-3 py-2 border border-outline-variant rounded-DEFAULT text-body-sm font-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
          <select
            value={access}
            onChange={(e) => setAccess(e.target.value as 'read' | 'edit' | 'manage')}
            className="bg-surface border border-outline-variant rounded-DEFAULT py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          >
            <option value="read">צפייה</option>
            <option value="edit">עריכה</option>
            <option value="manage">ניהול</option>
          </select>
          <button
            onClick={onAddGrant}
            disabled={busy || !principalId.trim()}
            className="bg-surface-container-high hover:bg-surface-variant text-on-surface font-label-xs text-label-xs px-3 py-2 rounded flex items-center gap-1 border border-outline-variant transition-colors disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-sm">person_add</span>
            הוסף
          </button>
        </div>
      </div>
    </AppShell>
  );
}
