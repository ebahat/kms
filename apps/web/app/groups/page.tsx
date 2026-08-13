'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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

  if (!session) return <main style={{ padding: '2rem' }}>טוען...</main>;

  return (
    <main style={{ padding: '2rem' }}>
      <nav style={{ marginBottom: '1rem' }}>
        <Link href="/home">בית</Link>
      </nav>
      <h1>קבוצות</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {session.role === 'admin' && (
        <div style={{ display: 'flex', gap: '0.5rem', margin: '1rem 0' }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="שם קבוצה חדשה" />
          <button onClick={onCreate} disabled={creating || !newName.trim()}>
            צור קבוצה
          </button>
        </div>
      )}

      {groups === null ? (
        <p>טוען...</p>
      ) : groups.length === 0 ? (
        <p>אין קבוצות.</p>
      ) : (
        <ul>
          {groups.map((g) => (
            <li key={g.id}>
              <Link href={`/groups/${g.id}`}>{g.name}</Link>
              {g.memberUserIds && <span style={{ marginInlineStart: '0.5rem' }}>({g.memberUserIds.length} חברים)</span>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
