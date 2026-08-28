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
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant p-8">
          <h1 className="font-headline-md text-headline-md text-on-surface mb-6">הפעלת אימות דו-שלבי</h1>
          {error && <div className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{error}</div>}
          {enrollment ? (
            <>
              <p className="font-body-md text-body-md text-on-surface mb-4">סרוק את הקוד באפליקציית האימות שלך, או הזן את המפתח ידנית:</p>
              {qrDataUrl && (
                <img src={qrDataUrl} alt="QR provisioning code" width={200} height={200} className="mx-auto mb-4 rounded-DEFAULT border border-outline-variant" />
              )}
              <p className="font-code-sm text-code-sm text-on-surface-variant break-all bg-surface-container-low rounded-DEFAULT p-3 mb-4">{enrollment.secret}</p>
              <p className="font-body-sm text-body-sm text-on-surface-variant mb-4">
                אין קודי גיבוי במסך זה — איבוד המכשיר מחייב אישור שני-אנשים (בקש ממנהל אחר לאפס).
              </p>
              <button
                onClick={() => setConfirmed(true)}
                className="w-full py-2.5 rounded-DEFAULT bg-primary text-on-primary font-title-sm text-title-sm hover:bg-primary-container hover:text-on-primary-container transition-colors"
              >
                המשך
              </button>
            </>
          ) : (
            <p className="font-body-md text-body-md text-on-surface-variant">טוען...</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant p-8">
        <h1 className="font-headline-md text-headline-md text-on-surface mb-6">אימות דו-שלבי</h1>
        {error && <div className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="mb-4">
            <label htmlFor="code" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
              קוד מהאפליקציה
            </label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full px-3 py-2.5 border border-outline-variant rounded-DEFAULT text-body-md font-body-md text-on-surface bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-DEFAULT bg-primary text-on-primary font-title-sm text-title-sm hover:bg-primary-container hover:text-on-primary-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? '...' : 'אימות'}
          </button>
        </form>
      </div>
    </div>
  );
}
