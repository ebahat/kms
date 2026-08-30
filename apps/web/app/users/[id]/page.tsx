'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AppShell } from '../../../components/app-shell';
import { BackButton } from '../../../components/back-button';
import { GroupAssignment, GroupRolePicker } from '../../../components/group-role-picker';
import { ApiError, apiErrorMessage } from '../../../lib/api';
import { GroupSummary, groupsApi } from '../../../lib/groups-api';
import { UserSummary, usersApi } from '../../../lib/users-api';
import { useSession } from '../../../lib/use-session';

/** Edit-user screen (user-management plan, 2026-08-24) — no GET-by-id endpoint exists, so this
 * reuses the same list() the /users table already fetches and finds the matching row; the tenant's
 * user count doesn't yet warrant a dedicated endpoint for this. */
export default function EditUserPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const session = useSession();

  const [user, setUser] = useState<UserSummary | null>(null);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [groupAssignments, setGroupAssignments] = useState<GroupAssignment[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setNotFound(false);
    setError(null);
    try {
      const [users, allGroups] = await Promise.all([usersApi.list(), groupsApi.list()]);
      const found = users.find((u) => u.id === userId);
      if (!found) {
        setNotFound(true);
        return;
      }
      setUser(found);
      setGroups(allGroups);
      setEmail(found.email);
      setFirstName(found.firstName ?? '');
      setLastName(found.lastName ?? '');
      setRole(found.role);
      setGroupAssignments(
        allGroups
          .flatMap((g) => (g.members?.some((m) => m.userId === userId) ? [{ groupId: g.id, role: g.members!.find((m) => m.userId === userId)!.role }] : [])),
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(apiErrorMessage(e, 'שגיאה בטעינת המשתמש'));
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await usersApi.update(userId, {
        email: email.trim() !== user.email ? email.trim() : undefined,
        firstName: firstName.trim() !== (user.firstName ?? '') ? firstName.trim() : undefined,
        lastName: lastName.trim() !== (user.lastName ?? '') ? lastName.trim() : undefined,
        role: role !== user.role ? role : undefined,
        groups: groupAssignments,
      });
      setSaved(true);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'השמירה נכשלה'));
    } finally {
      setSaving(false);
    }
  }

  if (!session) return <div className="min-h-screen bg-background" />;
  if (session.role !== 'admin') {
    return (
      <AppShell session={session} active="admin">
        <p className="font-body-md text-body-md text-on-surface">אין הרשאה לצפות בעמוד זה.</p>
      </AppShell>
    );
  }
  if (notFound) {
    return (
      <AppShell session={session} active="admin">
        <p className="font-body-md text-body-md text-on-surface mb-4">המשתמש לא נמצא.</p>
        <Link href="/users" className="text-primary hover:underline">
          חזרה לניהול משתמשים
        </Link>
      </AppShell>
    );
  }
  if (!user) {
    return (
      <AppShell session={session} active="admin">
        <p className="font-body-md text-body-md text-on-surface-variant">טוען...</p>
      </AppShell>
    );
  }

  return (
    <AppShell session={session} active="admin">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <BackButton href="/users" label="ניהול משתמשים" />
          <h2 className="font-headline-md text-headline-md text-on-surface">עריכת משתמש</h2>
        </div>

        {error && <p className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{error}</p>}
        {saved && <p className="bg-primary-container/10 border border-primary text-on-surface rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">השינויים נשמרו.</p>}

        <form onSubmit={onSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="edit-first-name" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
                שם פרטי
              </label>
              <input
                id="edit-first-name"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-3 py-2 border border-outline-variant rounded-DEFAULT text-body-sm font-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label htmlFor="edit-last-name" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
                שם משפחה
              </label>
              <input
                id="edit-last-name"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3 py-2 border border-outline-variant rounded-DEFAULT text-body-sm font-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div>
            <label htmlFor="edit-email" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
              דוא&quot;ל
            </label>
            <input
              id="edit-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-outline-variant rounded-DEFAULT text-body-sm font-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            {user.status === 'pending' && email.trim().toLowerCase() !== user.email.toLowerCase() && (
              <p className="font-label-xs text-label-xs text-on-surface-variant mt-1">שינוי כתובת למשתמש ממתין ישלח הזמנה חדשה לכתובת החדשה.</p>
            )}
          </div>
          <div>
            <label htmlFor="edit-role" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
              תפקיד
            </label>
            <select
              id="edit-role"
              value={role}
              onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
              className="bg-surface border border-outline-variant rounded-DEFAULT py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="user">משתמש</option>
              <option value="admin">מנהל</option>
            </select>
            {role !== user.role && (
              <p className="font-label-xs text-label-xs text-on-surface-variant mt-1">שינוי תפקיד ינתק את כל ההתחברויות הפעילות של המשתמש.</p>
            )}
          </div>
          <div>
            <p className="block font-label-xs text-label-xs text-on-surface-variant mb-1">שיוך לקבוצות</p>
            <GroupRolePicker groups={groups} value={groupAssignments} onChange={setGroupAssignments} />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="bg-primary text-on-primary-dynamic font-title-sm text-title-sm py-2 px-4 rounded-DEFAULT hover:bg-primary-container hover:text-on-primary-container transition-colors disabled:opacity-60"
          >
            {saving ? '...' : 'שמור שינויים'}
          </button>
        </form>
      </div>
    </AppShell>
  );
}
