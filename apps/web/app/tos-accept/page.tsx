'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { tenantApi } from '../../lib/api';

// Must match CURRENT_TOS_VERSION in libs/contracts/src/tos.ts. Kept as a
// plain constant here rather than importing @kms/contracts' decorator-bearing
// module into a browser bundle.
const CURRENT_TOS_VERSION = '2026-07-01';

/** UI spec A4: blocking interstitial on first login / ToS update (PRD §6). Reached via the 451 redirect in lib/api.ts. */
export default function TosAcceptPage() {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAccept() {
    setError(null);
    setSubmitting(true);
    try {
      await tenantApi.post('/auth/tos/accept', { version: CURRENT_TOS_VERSION });
      router.push('/home');
    } catch {
      setError('שגיאה. נסה שוב.'); // "Error. Please try again."
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant p-8">
        <h1 className="font-headline-md text-headline-md text-on-surface mb-6">תנאי שימוש ומדיניות פרטיות</h1>
        {error && <div className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{error}</div>}
        <p className="font-body-md text-body-md text-on-surface mb-4">עליך לאשר את תנאי השימוש ומדיניות הפרטיות המעודכנים כדי להמשיך.</p>
        <div className="mb-4">
          <label className="flex items-center gap-2 font-body-sm text-body-sm text-on-surface">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary"
            />
            קראתי ואני מסכים/ה לתנאים
          </label>
        </div>
        <button
          disabled={!accepted || submitting}
          onClick={onAccept}
          className="w-full py-2.5 rounded-DEFAULT bg-primary text-on-primary font-title-sm text-title-sm hover:bg-primary-container hover:text-on-primary-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {submitting ? '...' : 'אישור והמשך'}
        </button>
      </div>
    </div>
  );
}
