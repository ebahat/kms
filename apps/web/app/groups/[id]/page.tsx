'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '../../../components/app-shell';
import { BackButton } from '../../../components/back-button';
import { ApiError, apiErrorMessage } from '../../../lib/api';
import { ROLE_LABELS, ROLE_ROW_TINT, ROLE_SELECT_COLOR } from '../../../components/group-role-picker';
import { GroupMemberRole, GroupSummary, groupsApi } from '../../../lib/groups-api';
import { UserSummary, usersApi } from '../../../lib/users-api';
import { useSession } from '../../../lib/use-session';

/** UI spec C2 detail — membership add/remove/delete are admin-only (GroupsController.updateMembers/remove). Deleting a group still referenced by a folder grant, calendar event, or kanban task 409s with a GROUP_IN_USE message, surfaced here rather than silently retried. */
export default function GroupDetailPage() {
  const params = useParams<{ id: string }>();
  const groupId = params.id;
  const session = useSession();
  const router = useRouter();

  const [group, setGroup] = useState<GroupSummary | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newMemberId, setNewMemberId] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<GroupMemberRole>('viewer');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [tenantUsers, setTenantUsers] = useState<UserSummary[]>([]);

  const load = useCallback(async () => {
    setNotFound(false);
    setError(null);
    try {
      const g = await groupsApi.detail(groupId);
      setGroup(g);
      setRenameValue(g.name);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(apiErrorMessage(e, 'שגיאה בטעינת הקבוצה'));
    }
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Powers the add-member autocomplete dropdown (2026-08-29) — admin-only, matching the fetch's own server-side guard (TenantUsersAdminController). */
  useEffect(() => {
    if (session?.role !== 'admin') return;
    usersApi.list().then(setTenantUsers).catch(() => setTenantUsers([]));
  }, [session?.role]);

  async function onRename() {
    if (!renameValue.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await groupsApi.rename(groupId, renameValue.trim());
      setRenaming(false);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'שינוי השם נכשל'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Takes an email, not a raw userId (2026-08-28 bug fix — the old free-text field sent whatever
   * was typed straight through as `userId`, so an admin typing an email got a raw "invalid id" from
   * the backend's ObjectId validation with no way to discover the actual id). Resolves the email via
   * `usersApi.lookupByEmail` first; a 404 there gets a clear "no such user" message instead.
   */
  async function onAddMember() {
    const email = newMemberId.trim();
    if (!email) return;
    setBusy(true);
    setError(null);
    try {
      const user = await usersApi.lookupByEmail(email);
      await groupsApi.updateMembers(groupId, { add: [{ userId: user.id, role: newMemberRole }] });
      setNewMemberId('');
      setNewMemberRole('viewer');
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setError(`לא נמצא משתמש עם האימייל "${email}"`);
      else setError(apiErrorMessage(e, 'הוספת החבר נכשלה'));
    } finally {
      setBusy(false);
    }
  }

  /** Re-adding an existing member with a different role changes it in place (setMember is a pull-then-push, not append). */
  async function onChangeMemberRole(userId: string, role: GroupMemberRole) {
    setBusy(true);
    setError(null);
    try {
      await groupsApi.updateMembers(groupId, { add: [{ userId, role }] });
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'שינוי התפקיד נכשל'));
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveMember(userId: string) {
    setBusy(true);
    setError(null);
    try {
      await groupsApi.updateMembers(groupId, { remove: [userId] });
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'הסרת החבר נכשלה'));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!window.confirm('למחוק את הקבוצה?')) return;
    setBusy(true);
    setError(null);
    try {
      await groupsApi.remove(groupId);
      router.push('/groups');
    } catch (e) {
      setError(apiErrorMessage(e, 'המחיקה נכשלה'));
      setBusy(false);
    }
  }

  if (!session) return <div className="min-h-screen bg-background" />;
  if (notFound) {
    return (
      <AppShell session={session} active="groups">
        <p className="font-body-md text-body-md text-on-surface mb-4">הקבוצה לא נמצאה.</p>
        <Link href="/groups" className="text-primary hover:underline">
          חזרה לקבוצות
        </Link>
      </AppShell>
    );
  }
  if (!group) {
    return (
      <AppShell session={session} active="groups">
        <p className="font-body-md text-body-md text-on-surface-variant">טוען...</p>
      </AppShell>
    );
  }

  return (
    <AppShell session={session} active="groups">
      <div className="flex items-center gap-3 mb-4">
        <BackButton href="/groups" label="חזרה לקבוצות" />
        <h1 className="font-headline-md text-headline-md text-on-surface">קבוצות</h1>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm mb-6">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-primary text-on-primary-dynamic flex items-center justify-center shadow-sm shrink-0">
              <span className="material-symbols-outlined text-[32px]">group</span>
            </div>
            <div>
              {renaming ? (
                <div className="flex items-center gap-2">
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="px-3 py-1.5 border border-outline-variant rounded-DEFAULT text-body-md font-body-md bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                  <button
                    onClick={onRename}
                    disabled={busy}
                    className="bg-primary text-on-primary-dynamic font-title-sm text-title-sm px-4 py-1.5 rounded-DEFAULT hover:bg-primary-container hover:text-on-primary-container transition-colors"
                  >
                    שמור
                  </button>
                  <button
                    onClick={() => {
                      setRenaming(false);
                      setRenameValue(group.name);
                    }}
                    disabled={busy}
                    className="border border-outline-variant text-on-surface font-title-sm text-title-sm px-4 py-1.5 rounded-DEFAULT hover:bg-surface-container-high transition-colors"
                  >
                    ביטול
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="font-headline-md text-headline-md text-on-surface">{group.name}</h2>
                  {session.role === 'admin' && (
                    <button
                      onClick={() => setRenaming(true)}
                      disabled={busy}
                      className="border border-outline-variant text-on-surface font-label-xs text-label-xs px-3 py-1 rounded-DEFAULT hover:bg-surface-container-high transition-colors"
                    >
                      שנה שם
                    </button>
                  )}
                </div>
              )}
              <p className="font-label-xs text-label-xs text-on-surface-variant mt-1">
                מזהה קבוצה: <span dir="ltr" className="font-code-sm text-code-sm select-all">{group.id}</span>
              </p>
            </div>
          </div>
          {session.role === 'admin' && (
            <button
              onClick={onDelete}
              disabled={busy}
              className="p-2 text-error hover:bg-error-container rounded transition-colors border border-outline-variant bg-surface-container-lowest"
              title="מחק קבוצה"
              aria-label="מחק קבוצה"
            >
              <span className="material-symbols-outlined">delete</span>
            </button>
          )}
        </div>
      </div>

      {error && <p className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{error}</p>}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-outline-variant bg-surface-container-low flex items-center gap-2">
          <span className="material-symbols-outlined text-on-surface-variant">group_add</span>
          <h3 className="font-title-sm text-title-sm text-on-surface">חברים</h3>
        </div>
        {group.members === undefined ? (
          <p className="font-body-sm text-body-sm text-on-surface-variant p-4">אין לך הרשאה לצפות בחברי הקבוצה.</p>
        ) : group.members.length === 0 ? (
          <p className="font-body-sm text-body-sm text-on-surface-variant p-4">אין חברים בקבוצה זו.</p>
        ) : (
          <table className="w-full text-right border-collapse">
            <tbody className="font-body-sm text-body-sm divide-y divide-outline-variant">
              {group.members.map((m) => (
                <tr key={m.userId} className={`transition-colors ${ROLE_ROW_TINT[m.role]}`}>
                  <td className="py-2 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[18px]">person</span>
                      </div>
                      <div className="min-w-0">
                        {m.firstName || m.lastName ? (
                          <p className="font-body-sm text-body-sm text-on-surface truncate">{[m.firstName, m.lastName].filter(Boolean).join(' ')}</p>
                        ) : (
                          <p className="font-body-sm text-body-sm text-on-surface-variant italic">ללא שם</p>
                        )}
                        <p className="font-code-sm text-code-sm text-on-surface-variant truncate">{m.email}</p>
                        <p className="font-code-sm text-code-sm text-on-surface-variant/70 truncate" dir="ltr">{m.userId}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-2 px-4 w-36">
                    {session.role === 'admin' ? (
                      <select
                        aria-label="תפקיד"
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => onChangeMemberRole(m.userId, e.target.value as GroupMemberRole)}
                        className={`rounded-DEFAULT py-1 px-2 border font-body-sm text-body-sm focus:outline-none focus:ring-1 ${ROLE_SELECT_COLOR[m.role]}`}
                      >
                        {(Object.entries(ROLE_LABELS) as [GroupMemberRole, string][]).map(([role, label]) => (
                          <option key={role} value={role}>
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`inline-flex items-center px-2 py-1 rounded-DEFAULT font-body-sm text-body-sm ${ROLE_SELECT_COLOR[m.role]}`}>
                        {ROLE_LABELS[m.role]}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-4 text-center w-16">
                    {session.role === 'admin' && (
                      <button
                        onClick={() => onRemoveMember(m.userId)}
                        disabled={busy}
                        className="text-error hover:bg-error-container p-1.5 rounded transition-colors"
                        title="הסר מהקבוצה"
                        aria-label="הסר מהקבוצה"
                      >
                        <span className="material-symbols-outlined text-[18px]">person_remove</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {session.role === 'admin' && (
          <div className="p-4 border-t border-outline-variant bg-surface-container-low flex gap-2 items-center">
            <input
              value={newMemberId}
              onChange={(e) => setNewMemberId(e.target.value)}
              placeholder="אימייל המשתמש"
              type="email"
              list="group-member-users"
              className="flex-1 px-3 py-2 border border-outline-variant rounded-DEFAULT text-body-sm font-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            {/* Autocomplete dropdown of every tenant user (2026-08-29) — a native <datalist> needs no new dependency and works with the existing free-text + lookupByEmail flow unchanged. */}
            <datalist id="group-member-users">
              {tenantUsers.map((u) => (
                <option key={u.id} value={u.email}>
                  {[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}
                </option>
              ))}
            </datalist>
            <select
              aria-label="תפקיד לחבר החדש"
              value={newMemberRole}
              onChange={(e) => setNewMemberRole(e.target.value as GroupMemberRole)}
              className={`rounded-DEFAULT py-2 px-3 border font-body-sm text-body-sm focus:outline-none focus:ring-1 ${ROLE_SELECT_COLOR[newMemberRole]}`}
            >
              {(Object.entries(ROLE_LABELS) as [GroupMemberRole, string][]).map(([role, label]) => (
                <option key={role} value={role}>
                  {label}
                </option>
              ))}
            </select>
            <button
              onClick={onAddMember}
              disabled={busy || !newMemberId.trim()}
              className="bg-primary text-on-primary-dynamic hover:bg-primary-container hover:text-on-primary-container px-4 py-2 rounded font-title-sm text-title-sm transition-colors flex items-center gap-2 disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[18px]">person_add</span>
              הוסף חבר
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
