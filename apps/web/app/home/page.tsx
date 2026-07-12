'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { tenantApi } from '../../lib/api';

type SessionInfo = { role: 'user' | 'admin'; edition: 'kb' | 'ocr' };

/** Edition-driven navigation shell (ADR-0009 G2) — a KB tenant never sees OCR nav and vice versa. Feature pages land in Phase 2+. */
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
            <span>תיקיות</span>
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
