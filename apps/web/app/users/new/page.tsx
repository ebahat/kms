'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../../components/app-shell';
import { BackButton } from '../../../components/back-button';
import { GroupAssignment, GroupRolePicker } from '../../../components/group-role-picker';
import { apiErrorMessage } from '../../../lib/api';
import { GroupSummary, groupsApi } from '../../../lib/groups-api';
import { usersApi } from '../../../lib/users-api';
import { useSession } from '../../../lib/use-session';

/** Create-user screen (2026-08-29) — was an inline expand/collapse form at the top of /users;
 * pulled out to its own route so "צור משתמש" is a real navigation, matching /users/[id]'s
 * already-established edit-screen shape. Routes back to /users on success. */
export default function NewUserPage() {
  const session = useSession();
  const router = useRouter();

  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [groupAssignments, setGroupAssignments] = useState<GroupAssignment[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    groupsApi.list().then(setGroups).catch(() => setGroups([]));
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !firstName.trim() || !lastName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const result = await usersApi.create(email.trim(), firstName.trim(), lastName.trim(), role, groupAssignments);
      router.push(`/users?invited=${encodeURIComponent(result.email)}`);
    } catch (e) {
      setError(apiErrorMessage(e, 'יצירת המשתמש נכשלה'));
    } finally {
      setCreating(false);
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

  return (
    <AppShell session={session} active="admin">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <BackButton href="/users" label="ניהול משתמשים" />
          <h2 className="font-headline-md text-headline-md text-on-surface">צור משתמש</h2>
        </div>

        {error && <p className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{error}</p>}

        <form onSubmit={onCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="new-user-first-name" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
                שם פרטי
              </label>
              <input
                id="new-user-first-name"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-3 py-2 border border-outline-variant rounded-DEFAULT text-body-sm font-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label htmlFor="new-user-last-name" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
                שם משפחה
              </label>
              <input
                id="new-user-last-name"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3 py-2 border border-outline-variant rounded-DEFAULT text-body-sm font-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div>
            <label htmlFor="new-user-email" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
              דוא&quot;ל
            </label>
            <input
              id="new-user-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-outline-variant rounded-DEFAULT text-body-sm font-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label htmlFor="new-user-role" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
              תפקיד
            </label>
            <select
              id="new-user-role"
              value={role}
              onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
              className="bg-surface border border-outline-variant rounded-DEFAULT py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="user">משתמש</option>
              <option value="admin">מנהל</option>
            </select>
          </div>
          <div>
            <p className="block font-label-xs text-label-xs text-on-surface-variant mb-1">שיוך לקבוצות (אופציונלי)</p>
            <GroupRolePicker groups={groups} value={groupAssignments} onChange={setGroupAssignments} />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating || !email.trim() || !firstName.trim() || !lastName.trim()}
              className="bg-primary text-on-primary-dynamic font-title-sm text-title-sm py-2 px-4 rounded-DEFAULT flex items-center gap-2 hover:bg-primary-container hover:text-on-primary-container transition-colors disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-sm">person_add</span>
              {creating ? '...' : 'צור משתמש'}
            </button>
            <Link
              href="/users"
              className="border border-outline-variant text-on-surface font-title-sm text-title-sm py-2 px-4 rounded-DEFAULT hover:bg-surface-container-high transition-colors"
            >
              ביטול
            </Link>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
