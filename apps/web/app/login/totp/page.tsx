'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { tenantApi, ApiError } from '../../../lib/api';

type EnrollResult = { provisioningUri: string; secret: string; backupCodes: string[] };

/** UI spec A2 (challenge) + A3 (first-login enrollment: QR + manual secret + one-time backup codes). */
export default function TotpPage() {
  const router = useRouter();
  const [needsEnroll, setNeedsEnroll] = useState(false);
  const [enrollment, setEnrollment] = useState<EnrollResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [codesConfirmed, setCodesConfirmed] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNeedsEnroll(params.get('enroll') === '1');
  }, []);

  useEffect(() => {
    if (!needsEnroll || enrollment) return;
    tenantApi
      .post<EnrollResult>('/auth/totp/enroll')
      .then(async (result) => {
        setEnrollment(result);
        setQrDataUrl(await QRCode.toDataURL(result.provisioningUri));
      })
      .catch(() => setError('שגיאה בהפעלת האימות הדו-שלבי.')); // "Error activating two-factor auth."
  }, [needsEnroll, enrollment]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await tenantApi.post('/auth/totp', { code });
      router.push('/home');
    } catch (err) {
      if (err instanceof ApiError && err.body && (err.body as any).error === 'TOTP_RATE_LIMITED') {
        setError('יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.'); // rate-limited (sec §2, 5/5min)
      } else {
        setError('קוד שגוי.'); // "Incorrect code."
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (needsEnroll && !codesConfirmed) {
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
              <p>
                <strong>שמור את קודי הגיבוי הבאים — הם יוצגו פעם אחת בלבד:</strong>
              </p>
              <div className="backup-codes">
                {enrollment.backupCodes.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
              <button className="auth-submit" onClick={() => setCodesConfirmed(true)}>
                שמרתי את הקודים — המשך
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
            <label htmlFor="code">קוד מהאפליקציה או קוד גיבוי</label>
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
