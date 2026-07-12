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
    <div className="auth-shell">
      <div className="auth-card">
        <h1>כניסת מנהל פלטפורמה</h1>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="auth-field">
            <label htmlFor="email">דוא"ל</label>
            <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="auth-field">
            <label htmlFor="password">סיסמה</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {captchaRequired && <div className="auth-hint">אימות CAPTCHA יופיע כאן.</div>}
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? '...' : 'כניסה'}
          </button>
        </form>
      </div>
    </div>
  );
}
