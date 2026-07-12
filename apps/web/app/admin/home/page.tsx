'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { portalApi } from '../../../lib/api';

type TenantSummary = { name: string; edition: 'kb' | 'ocr'; status: 'active' | 'suspended' };

/** Platform-admin dashboard placeholder (PRD §5) — exercises the tenant-lifecycle CRUD built in Phase 1.6. */
export default function AdminHomePage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<TenantSummary[] | null>(null);

  useEffect(() => {
    portalApi
      .get<TenantSummary[]>('/platform-admin/tenants')
      .then(setTenants)
      .catch(() => router.push('/admin/login'));
  }, [router]);

  async function onLogout() {
    await portalApi.post('/auth/logout');
    router.push('/admin/login');
  }

  return (
    <main style={{ padding: '2rem' }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <h1>ניהול פלטפורמה</h1>
        <button onClick={onLogout}>יציאה</button>
      </nav>
      <h2>שוכרים (Tenants)</h2>
      {!tenants ? (
        <p>טוען...</p>
      ) : (
        <ul>
          {tenants.map((t) => (
            <li key={t.name}>
              {t.name} — {t.edition} — {t.status}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
