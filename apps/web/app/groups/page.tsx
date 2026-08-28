'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '../../components/app-shell';
import { apiErrorMessage } from '../../lib/api';
import { GroupSummary, groupsApi } from '../../lib/groups-api';
import { useSession } from '../../lib/use-session';

/** UI spec C2 — plain list/detail is open to any authenticated tenant user; create/membership/delete are admin-only (matches GroupsController's own @UseGuards(AdminOnlyGuard) split). */
export default function GroupsPage() {
  const session = useSession();
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      setGroups(await groupsApi.list());
    } catch (e) {
      setError(apiErrorMessage(e, 'שגיאה בטעינת הקבוצות'));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await groupsApi.create(newName.trim());
      setNewName('');
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'יצירת הקבוצה נכשלה'));
    } finally {
      setCreating(false);
    }
  }

  if (!session) return <div className="min-h-screen bg-background" />;

  return (
    <AppShell session={session} active="groups">
      <div className="flex justify-between items-end pb-4 border-b border-outline-variant mb-6">
        <h2 className="font-display-lg text-display-lg text-on-surface">קבוצות</h2>
        {session.role === 'admin' && (
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="שם קבוצה חדשה"
              className="px-3 py-2 border border-outline-variant rounded-DEFAULT text-body-sm font-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={onCreate}
              disabled={creating || !newName.trim()}
              className="bg-primary text-on-primary-dynamic font-title-sm text-title-sm py-2 px-4 rounded-DEFAULT flex items-center gap-2 hover:bg-primary-container hover:text-on-primary-container transition-colors disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              צור קבוצה
            </button>
          </div>
        )}
      </div>

      {error && <p className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{error}</p>}

      {groups === null ? (
        <p className="font-body-md text-body-md text-on-surface-variant">טוען...</p>
      ) : groups.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">אין קבוצות.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`/groups/${g.id}`}
              className="p-3 rounded-lg border border-outline-variant bg-surface-container-lowest hover:bg-surface-container-high transition-colors flex items-start gap-3 shadow-sm"
            >
              <div className="w-10 h-10 rounded bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined">group</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-1">
                  <h4 className="font-title-sm text-title-sm text-on-surface truncate">{g.name}</h4>
                  {g.members && (
                    <span className="font-label-xs text-label-xs bg-surface-variant text-on-surface-variant px-2 py-0.5 rounded-full shrink-0">
                      {g.members.length} חברים
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
