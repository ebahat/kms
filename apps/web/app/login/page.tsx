'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { tenantApi, ApiError } from '../../lib/api';

/** UI spec A1: identical error copy/timing for unknown-user vs wrong-password (sec §2); CAPTCHA state after repeated failures. */
export default function LoginPage() {
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
      const result = await tenantApi.post<{ mfaEnrolled: boolean }>('/auth/login', { email, password });
      router.push(result.mfaEnrolled ? '/login/totp' : '/login/totp?enroll=1');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && err.body && (err.body as any).error === 'CAPTCHA_REQUIRED') {
        setCaptchaRequired(true);
        setError('נדרש אימות נוסף. אנא נסה שוב.'); // "Additional verification required. Please try again."
      } else {
        // Deliberately generic — matches the backend's uniform error for unknown-user/wrong-password/locked (sec §2).
        setError('דוא"ל או סיסמה שגויים.'); // "Invalid email or password."
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>כניסה</h1>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="auth-field">
            <label htmlFor="email">דוא"ל</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
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
          {captchaRequired && (
            <div className="auth-hint">
              {/* No CAPTCHA provider is wired yet (backend NoopCaptchaVerifier) — placeholder for the real widget. */}
              אימות CAPTCHA יופיע כאן.
            </div>
          )}
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? '...' : 'כניסה'}
          </button>
        </form>
        <div className="auth-hint">
          <a href="/password-reset">שכחת סיסמה?</a>
        </div>
      </div>
    </div>
  );
}
