'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, tenantApi } from '../../../lib/api';

/** useSearchParams() requires a Suspense boundary in the App Router, or the build fails. */
export default function PasswordResetConfirmPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <ConfirmForm />
    </Suspense>
  );
}

function ConfirmForm() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const token = params.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await tenantApi.post('/auth/password-reset/confirm', { email, token, newPassword });
      router.push('/login?reset=1');
    } catch (err) {
      if (err instanceof ApiError && err.body && (err.body as any).error === 'PASSWORD_BREACHED') {
        setError('הסיסמה שנבחרה נמצאה בדליפות מידע ידועות. יש לבחור סיסמה אחרת.');
      } else if (err instanceof ApiError && err.status === 401) {
        setError('קישור האיפוס אינו תקף או שפג תוקפו. יש לבקש קישור חדש.');
      } else {
        setError('האיפוס נכשל. יש לנסות שוב.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!email || !token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant p-8">
          <h1 className="font-headline-md text-headline-md text-on-surface mb-6">איפוס סיסמה</h1>
          <div className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">קישור האיפוס אינו תקין.</div>
          <div className="font-body-sm text-body-sm text-on-surface-variant mt-4">
            <a href="/password-reset" className="text-primary hover:underline">
              בקשת קישור חדש
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant p-8">
        <h1 className="font-headline-md text-headline-md text-on-surface mb-6">קביעת סיסמה חדשה</h1>
        {error && <div className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="mb-4">
            <label htmlFor="new-password" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
              סיסמה חדשה
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2.5 border border-outline-variant rounded-DEFAULT text-body-md font-body-md text-on-surface bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-DEFAULT bg-primary text-on-primary font-title-sm text-title-sm hover:bg-primary-container hover:text-on-primary-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? '...' : 'קביעת סיסמה'}
          </button>
        </form>
      </div>
    </div>
  );
}
