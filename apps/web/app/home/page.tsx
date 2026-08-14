'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { tenantApi } from '../../lib/api';

type SessionInfo = { role: 'user' | 'admin'; edition: 'kb' | 'ocr' };

/**
 * Edition-driven navigation shell (ADR-0009 G2) — a KB tenant never sees OCR nav and vice versa.
 * "תיקיות"/"קבוצות" (Phase 2 UI plan Task 6) are the first real feature links here; "שיחה עם AI"
 * and "ניהול משתמשים" stay plain labels since chat (Phase 3/4) and the C1 user-management screen
 * don't exist yet. Groups is shown to every KB user, not just admins — GroupsController's own
 * list()/detail() routes are open to any authenticated tenant user (verified against the controller,
 * not assumed); only create/membership/delete are admin-gated, which the /groups screen itself
 * enforces client-side to match.
 */
export default function HomePage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    tenantApi
      .get<SessionInfo>('/auth/session')
      .then(setSession)
      .catch(() => router.push('/login'));
  }, [router]);

  async function onLogout() {
    await tenantApi.post('/auth/logout');
    router.push('/login');
  }

  if (!session) return <main style={{ padding: '2rem' }}>טוען...</main>;

  return (
    <main style={{ padding: '2rem' }}>
      <nav style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        {session.edition === 'kb' ? (
          <>
            <Link href="/folders">תיקיות</Link>
            <Link href="/groups">קבוצות</Link>
            <span>שיחה עם AI</span>
          </>
        ) : (
          <span>סריקת OCR</span>
        )}
        {session.role === 'admin' && <span>ניהול משתמשים</span>}
        <button onClick={onLogout}>יציאה</button>
      </nav>
      <p>ברוך/ה הבא/ה — מהדורת {session.edition === 'kb' ? 'ניהול ידע' : 'OCR חכם'}.</p>
    </main>
  );
}
