'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { portalApi, ApiError } from '../../../../lib/api';

type EnrollResult = { provisioningUri: string; secret: string };

/** Platform realm: no backup codes (ADR-0004 — no self-service MFA recovery, see two-person reset). */
export default function AdminTotpPage() {
  const router = useRouter();
  const [needsEnroll, setNeedsEnroll] = useState(false);
  const [enrollment, setEnrollment] = useState<EnrollResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNeedsEnroll(params.get('enroll') === '1');
  }, []);

  useEffect(() => {
    if (!needsEnroll || enrollment) return;
    portalApi
      .post<EnrollResult>('/auth/totp/enroll')
      .then(async (result) => {
        setEnrollment(result);
        setQrDataUrl(await QRCode.toDataURL(result.provisioningUri));
      })
      .catch(() => setError('שגיאה בהפעלת האימות הדו-שלבי.'));
  }, [needsEnroll, enrollment]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await portalApi.post('/auth/totp', { code });
      router.push('/admin/home');
    } catch (err) {
      if (err instanceof ApiError && err.body && (err.body as any).error === 'TOTP_RATE_LIMITED') {
        setError('יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.');
      } else {
        setError('קוד שגוי.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (needsEnroll && !confirmed) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>הפעלת אימות דו-שלבי</h1>
          {error && <div className="auth-error">{error}</div>}
          {enrollment ? (
            <>
              <p>סרוק את הקוד באפליקציית האימות שלך, או הזן את המפתח ידנית:</p>
              {qrDataUrl && <img src={qrDataUrl} alt="QR provisioning code" width={200} height={200} />}
              <p style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{enrollment.secret}</p>
              <p className="auth-hint">
                אין קודי גיבוי במסך זה — איבוד המכשיר מחייב אישור שני-אנשים (בקש ממנהל אחר לאפס).
              </p>
              <button className="auth-submit" onClick={() => setConfirmed(true)}>
                המשך
              </button>
            </>
          ) : (
            <p>טוען...</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>אימות דו-שלבי</h1>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="auth-field">
            <label htmlFor="code">קוד מהאפליקציה</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? '...' : 'אימות'}
          </button>
        </form>
      </div>
    </div>
  );
}
