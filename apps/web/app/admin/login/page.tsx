'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { portalApi, ApiError } from '../../../lib/api';

/** UI spec E1: platform-admin login — distinct realm/cookie, TOTP mandatory, no ToS/edition concept (ADR-0004). */
export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await portalApi.post<{ mfaEnrolled: boolean }>('/auth/login', { email, password });
      router.push(result.mfaEnrolled ? '/admin/login/totp' : '/admin/login/totp?enroll=1');
    } catch (err) {
      if (err instanceof ApiError && err.body && (err.body as any).error === 'CAPTCHA_REQUIRED') {
        setCaptchaRequired(true);
        setError('נדרש אימות נוסף. אנא נסה שוב.');
      } else {
        setError('דוא"ל או סיסמה שגויים.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant p-8">
        <h1 className="font-headline-md text-headline-md text-on-surface mb-6">כניסת מנהל פלטפורמה</h1>
        {error && <div className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="mb-4">
            <label htmlFor="email" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
              דוא&quot;ל
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 border border-outline-variant rounded-DEFAULT text-body-md font-body-md text-on-surface bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
            />
          </div>
          <div className="mb-4">
            <label htmlFor="password" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
              סיסמה
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 border border-outline-variant rounded-DEFAULT text-body-md font-body-md text-on-surface bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
            />
          </div>
          {captchaRequired && <div className="font-body-sm text-body-sm text-on-surface-variant mb-4">אימות CAPTCHA יופיע כאן.</div>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-DEFAULT bg-primary text-on-primary font-title-sm text-title-sm hover:bg-primary-container hover:text-on-primary-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? '...' : 'כניסה'}
          </button>
        </form>
      </div>
    </div>
  );
}
