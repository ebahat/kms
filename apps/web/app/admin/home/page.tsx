'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { portalApi } from '../../../lib/api';
import { platformTenantsApi, TenantDetail } from '../../../lib/platform-tenants-api';

const STATUS_BADGE: Record<TenantDetail['status'], string> = {
  active: 'bg-secondary-container text-on-secondary-container',
  suspended: 'bg-error-container text-on-error-container',
};
const STATUS_LABEL: Record<TenantDetail['status'], string> = { active: 'פעיל', suspended: 'מושעה' };

/** Platform-admin dashboard (PRD §5) — tenant-lifecycle CRUD built in Phase 1.6, now with a real edit screen (Phase C follow-up). */
export default function AdminHomePage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<TenantDetail[] | null>(null);

  useEffect(() => {
    platformTenantsApi
      .list()
      .then(setTenants)
      .catch(() => router.push('/admin/login'));
  }, [router]);

  async function onLogout() {
    await portalApi.post('/auth/logout');
    router.push('/admin/login');
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-surface-container shadow-sm flex justify-between items-center px-container-padding h-row-height-standard border-b border-outline-variant">
        <h1 className="font-headline-md text-headline-md text-primary">ניהול פלטפורמה</h1>
        <button
          onClick={onLogout}
          className="border border-outline-variant text-on-surface font-title-sm text-title-sm px-4 py-1.5 rounded-DEFAULT hover:bg-surface-container-high transition-colors"
        >
          יציאה
        </button>
      </header>
      <main className="p-container-padding max-w-5xl mx-auto">
        <div className="flex justify-between items-end mb-6">
          <h2 className="font-display-lg text-display-lg text-on-surface">ארגונים (Tenants)</h2>
          <Link
            href="/admin/tenants/new"
            className="bg-primary text-on-primary font-title-sm text-title-sm py-2 px-4 rounded-DEFAULT flex items-center gap-2 hover:bg-primary-container hover:text-on-primary-container transition-colors"
          >
            <span className="material-symbols-outlined text-sm">domain_add</span>
            צור ארגון חדש
          </Link>
        </div>
        {!tenants ? (
          <p className="font-body-md text-body-md text-on-surface-variant">טוען...</p>
        ) : (
          <div className="bg-surface-container-lowest rounded-lg border border-outline-variant divide-y divide-outline-variant overflow-hidden shadow-sm">
            {tenants.map((t) => (
              <Link
                key={t._id}
                href={`/admin/tenants/${t._id}`}
                className="flex items-center gap-4 px-4 h-row-height-standard font-body-sm text-body-sm text-on-surface hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-on-surface-variant">domain</span>
                <span className="font-medium">{t.name}</span>
                <span className="text-on-surface-variant font-code-sm text-code-sm">{t.edition}</span>
                <span className={`${STATUS_BADGE[t.status]} font-label-xs text-label-xs px-2 py-0.5 rounded-full mr-auto`}>{STATUS_LABEL[t.status]}</span>
                <span className="material-symbols-outlined text-on-surface-variant">chevron_left</span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
