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
    <div className="auth-shell">
      <div className="auth-card">
        <h1>תנאי שימוש ומדיניות פרטיות</h1>
        {error && <div className="auth-error">{error}</div>}
        <p>עליך לאשר את תנאי השימוש ומדיניות הפרטיות המעודכנים כדי להמשיך.</p>
        <div className="auth-field">
          <label>
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> קראתי ואני מסכים/ה
            לתנאים
          </label>
        </div>
        <button className="auth-submit" disabled={!accepted || submitting} onClick={onAccept}>
          {submitting ? '...' : 'אישור והמשך'}
        </button>
      </div>
    </div>
  );
}
