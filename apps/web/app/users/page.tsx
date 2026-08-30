'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '../../components/app-shell';
import { apiErrorMessage } from '../../lib/api';
import { CsvImportRowResult, UserSummary, usersApi } from '../../lib/users-api';
import { useSession } from '../../lib/use-session';

const STATUS_LABELS: Record<UserSummary['status'], string> = { pending: 'ממתין להפעלה', active: 'פעיל', inactive: 'מושבת', locked: 'נעול' };
const STATUS_DOT: Record<UserSummary['status'], string> = { pending: 'bg-secondary', active: 'bg-primary', inactive: 'bg-outline', locked: 'bg-error' };
const STATUS_BADGE: Record<UserSummary['status'], string> = {
  pending: 'bg-secondary-container text-on-secondary-container',
  active: 'bg-secondary-container text-on-secondary-container',
  inactive: 'bg-surface-variant text-on-surface-variant',
  locked: 'bg-error-container text-on-error-container',
};

/** useSearchParams() (picking up /users/new's ?invited= redirect) requires a Suspense boundary in the App Router, or the build fails prerendering this page — same pattern as login/page.tsx and activate/page.tsx. */
export default function UsersPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <UsersPageContent />
    </Suspense>
  );
}

/** UI spec C1 — TenantUsersAdminController's @UseGuards(AdminOnlyGuard) is class-level, so every route here (including list) 403s for a non-admin server-side; the home-page nav link is admin-only too, so a non-admin can only reach this page by typing the URL directly, in which case it just surfaces the 403 as a generic load error. */
function UsersPageContent() {
  const session = useSession();
  const searchParams = useSearchParams();
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [inviteSentFor, setInviteSentFor] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [importResults, setImportResults] = useState<CsvImportRowResult[] | null>(null);
  const [importing, setImporting] = useState(false);

  async function load() {
    try {
      setUsers(await usersApi.list());
    } catch (e) {
      setError(apiErrorMessage(e, 'שגיאה בטעינת המשתמשים'));
    }
  }

  useEffect(() => {
    load();
  }, []);

  /** Picks up the invite-sent confirmation from /users/new's redirect (2026-08-29 — create-user moved to its own screen). */
  useEffect(() => {
    const invited = searchParams.get('invited');
    if (invited) setInviteSentFor(invited);
  }, [searchParams]);

  async function onToggleStatus(user: UserSummary) {
    setBusyId(user.id);
    setError(null);
    try {
      if (user.status === 'active') await usersApi.deactivate(user.id);
      else await usersApi.reactivate(user.id);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'הפעולה נכשלה'));
    } finally {
      setBusyId(null);
    }
  }

  async function onResendInvite(user: UserSummary) {
    setBusyId(user.id);
    setError(null);
    try {
      await usersApi.resendInvite(user.id);
      setInviteSentFor(user.email);
    } catch (e) {
      setError(apiErrorMessage(e, 'שליחת ההזמנה מחדש נכשלה'));
    } finally {
      setBusyId(null);
    }
  }

  async function onImportFile(file: File) {
    setImporting(true);
    setError(null);
    setImportResults(null);
    try {
      const csvContent = await file.text();
      const { results } = await usersApi.importCsv(csvContent);
      setImportResults(results);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'הייבוא נכשל'));
    } finally {
      setImporting(false);
    }
  }

  if (!session) return <div className="min-h-screen bg-background" />;
  const isAdmin = session.role === 'admin';

  return (
    <AppShell session={session} active="admin">
      <div className="flex justify-between items-end pb-4 border-b border-outline-variant mb-6">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-surface">ניהול משתמשים</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">צפה, ערוך ונהל הרשאות משתמשים במערכת.</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
          <Link
            href="/users/new"
            className="bg-primary text-on-primary-dynamic font-title-sm text-title-sm py-2 px-4 rounded-DEFAULT flex items-center gap-2 hover:bg-primary-container hover:text-on-primary-container transition-colors shadow-sm"
          >
            <span className="material-symbols-outlined text-sm">person_add</span>
            צור משתמש
          </Link>
          <Link
            href="/recycle-bin"
            className="bg-surface-container-high text-on-surface font-title-sm text-title-sm py-2 px-4 rounded-DEFAULT border border-outline-variant flex items-center gap-2 hover:bg-surface-container-highest transition-colors shadow-sm"
          >
            <span className="material-symbols-outlined text-sm">recycling</span>
            סל מיחזור
          </Link>
          <label className="bg-surface-container-high text-on-surface font-title-sm text-title-sm py-2 px-4 rounded-DEFAULT border border-outline-variant flex items-center gap-2 hover:bg-surface-container-highest transition-colors shadow-sm cursor-pointer">
            <span className="material-symbols-outlined text-sm">upload_file</span>
            ייבוא משתמשים מרוכז
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={importing}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onImportFile(file);
                e.target.value = '';
              }}
            />
          </label>
          </div>
        )}
      </div>

      {error && <p className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{error}</p>}

      {inviteSentFor && (
        <div className="border border-primary bg-primary-container/10 rounded-lg p-4 mb-6">
          <p className="font-body-sm text-body-sm text-on-surface">
            נשלחה הזמנה בדוא&quot;ל אל <strong>{inviteSentFor}</strong>. הקישור בתוקף ל-24 שעות.
          </p>
          <div className="mt-2">
            <button onClick={() => setInviteSentFor(null)} className="text-primary hover:underline font-label-xs text-label-xs">
              סגור
            </button>
          </div>
        </div>
      )}

      {users === null ? (
        <p className="font-body-md text-body-md text-on-surface-variant">טוען...</p>
      ) : users.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">אין משתמשים.</p>
      ) : (
        <div className="bg-surface-container-lowest rounded-lg border border-outline-variant overflow-hidden shadow-sm">
          <table className="w-full text-right border-collapse">
            <thead className="bg-surface-container-low border-b border-outline-variant font-title-sm text-title-sm text-on-surface-variant">
              <tr>
                <th className="p-4 font-medium">שם</th>
                <th className="p-4 font-medium">דוא&quot;ל</th>
                <th className="p-4 font-medium">תפקיד</th>
                <th className="p-4 font-medium">סטטוס</th>
                <th className="p-4 font-medium">MFA</th>
                {isAdmin && <th className="p-4 font-medium text-center">פעולות</th>}
              </tr>
            </thead>
            <tbody className="font-body-sm text-body-sm text-on-surface divide-y divide-outline-variant">
              {users.map((u) => (
                <tr key={u.id} className={`hover:bg-surface-container-high transition-colors h-row-height-standard ${u.status === 'inactive' ? 'bg-surface-container opacity-75' : ''}`}>
                  <td className="p-4">
                    {u.firstName || u.lastName ? (
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0 font-label-xs text-label-xs">
                          {(u.firstName?.[0] ?? '') + (u.lastName?.[0] ?? '')}
                        </div>
                        <span className="font-body-sm text-body-sm text-on-surface">
                          {[u.firstName, u.lastName].filter(Boolean).join(' ')}
                        </span>
                      </div>
                    ) : (
                      <span className="font-body-sm text-body-sm text-on-surface-variant italic">ללא שם</span>
                    )}
                  </td>
                  <td className="p-4 font-code-sm text-code-sm text-on-surface-variant">{u.email}</td>
                  <td className="p-4">{u.role === 'admin' ? 'מנהל' : 'משתמש'}</td>
                  <td className="p-4">
                    <span className={`${STATUS_BADGE[u.status]} font-label-xs text-label-xs px-2 py-1 rounded-full flex items-center w-max gap-1`}>
                      <span className={`w-1.5 h-1.5 rounded-full inline-block ${STATUS_DOT[u.status]}`} />
                      {STATUS_LABELS[u.status]}
                    </span>
                  </td>
                  <td className="p-4">{u.mfaEnabled ? 'כן' : 'לא'}</td>
                  {isAdmin && (
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-2">
                        <Link
                          href={`/users/${u.id}`}
                          className="text-on-surface-variant hover:text-primary transition-colors p-1"
                          title="ערוך"
                          aria-label="ערוך"
                        >
                          <span className="material-symbols-outlined text-sm">edit</span>
                        </Link>
                        {u.status === 'pending' && (
                          <button
                            onClick={() => onResendInvite(u)}
                            disabled={busyId === u.id}
                            className="text-on-surface-variant hover:text-primary transition-colors p-1"
                            title="שלח הזמנה מחדש"
                            aria-label="שלח הזמנה מחדש"
                          >
                            <span className="material-symbols-outlined text-sm">forward_to_inbox</span>
                          </button>
                        )}
                        {u.status !== 'locked' && u.status !== 'pending' && (
                          <button
                            onClick={() => onToggleStatus(u)}
                            disabled={busyId === u.id}
                            className="text-on-surface-variant hover:text-primary transition-colors p-1"
                            title={u.status === 'active' ? 'השבת' : 'הפעל מחדש'}
                            aria-label={u.status === 'active' ? 'השבת' : 'הפעל מחדש'}
                          >
                            <span className="material-symbols-outlined text-sm">{u.status === 'active' ? 'block' : 'how_to_reg'}</span>
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isAdmin && (
        <p className="font-label-xs text-label-xs text-on-surface-variant mt-4">
          עמודות CSV נדרשות: email, firstName, lastName, role (אופציונלי), groups (אופציונלי — לדוגמה &quot;Sales:editor;Legal:viewer&quot;).
        </p>
      )}

      {importResults && (
        <div className="mt-4">
          <h3 className="font-title-sm text-title-sm text-on-surface mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-error text-sm">warning</span>
            תוצאות ייבוא אחרון
          </h3>
          <div className="bg-surface-container-lowest rounded-lg border border-outline-variant overflow-hidden shadow-sm">
            <table className="w-full text-right border-collapse">
              <thead className="bg-surface-container-low border-b border-outline-variant font-title-sm text-title-sm text-on-surface-variant">
                <tr>
                  <th className="p-3 font-medium">שורה</th>
                  <th className="p-3 font-medium">דוא&quot;ל</th>
                  <th className="p-3 font-medium">תוצאה</th>
                </tr>
              </thead>
              <tbody className="font-body-sm text-body-sm text-on-surface divide-y divide-outline-variant">
                {importResults.map((r) => (
                  <tr key={r.row}>
                    <td className="p-3">{r.row}</td>
                    <td className="p-3 font-code-sm text-code-sm text-on-surface-variant">{r.email ?? '—'}</td>
                    <td className="p-3">
                      {r.status === 'created' ? (
                        <span className="text-primary">נוצר</span>
                      ) : (
                        <span className="text-error">שגיאה: {r.error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
