'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ApiError, apiErrorMessage } from '../../../lib/api';
import { GroupSummary, groupsApi } from '../../../lib/groups-api';
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
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setNotFound(false);
    setError(null);
    try {
      setGroup(await groupsApi.detail(groupId));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(apiErrorMessage(e, 'שגיאה בטעינת הקבוצה'));
    }
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onAddMember() {
    if (!newMemberId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await groupsApi.updateMembers(groupId, { add: [newMemberId.trim()] });
      setNewMemberId('');
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'הוספת החבר נכשלה'));
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

  if (!session) return <main style={{ padding: '2rem' }}>טוען...</main>;
  if (notFound) {
    return (
      <main style={{ padding: '2rem' }}>
        <p>הקבוצה לא נמצאה.</p>
        <Link href="/groups">חזרה לקבוצות</Link>
      </main>
    );
  }
  if (!group) return <main style={{ padding: '2rem' }}>טוען...</main>;

  return (
    <main style={{ padding: '2rem' }}>
      <nav style={{ marginBottom: '1rem' }}>
        <Link href="/groups">קבוצות</Link>
      </nav>
      <h1>{group.name}</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {session.role === 'admin' && (
        <button onClick={onDelete} disabled={busy} style={{ margin: '1rem 0' }}>
          מחק קבוצה
        </button>
      )}

      <h2>חברים</h2>
      {group.memberUserIds === undefined ? (
        <p>אין לך הרשאה לצפות בחברי הקבוצה.</p>
      ) : group.memberUserIds.length === 0 ? (
        <p>אין חברים בקבוצה זו.</p>
      ) : (
        <ul>
          {group.memberUserIds.map((userId) => (
            <li key={userId}>
              {userId}
              {session.role === 'admin' && (
                <button onClick={() => onRemoveMember(userId)} disabled={busy} style={{ marginInlineStart: '0.5rem' }}>
                  הסר
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {session.role === 'admin' && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input value={newMemberId} onChange={(e) => setNewMemberId(e.target.value)} placeholder="מזהה משתמש" />
          <button onClick={onAddMember} disabled={busy || !newMemberId.trim()}>
            הוסף חבר
          </button>
        </div>
      )}
    </main>
  );
}
