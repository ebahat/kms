'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError } from '../../lib/api';
import { activationApi } from '../../lib/activation-api';

/** useSearchParams() requires a Suspense boundary in the App Router, or the build fails. */
export default function ActivatePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <ActivateForm />
    </Suspense>
  );
}

function ActivateForm() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const token = params.get('token') ?? '';

  const [checking, setChecking] = useState(true);
  const [linkValid, setLinkValid] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!email || !token) {
      setChecking(false);
      return;
    }
    activationApi
      .check(email, token)
      .then((r) => setLinkValid(r.valid))
      .catch(() => setLinkValid(false))
      .finally(() => setChecking(false));
  }, [email, token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('הסיסמאות אינן תואמות.');
      return;
    }
    setSubmitting(true);
    try {
      await activationApi.confirm(email, token, newPassword);
      router.push('/login?activated=1');
    } catch (err) {
      if (err instanceof ApiError && err.body && (err.body as any).error === 'PASSWORD_BREACHED') {
        setError('הסיסמה שנבחרה נמצאה בדליפות מידע ידועות. יש לבחור סיסמה אחרת.');
      } else if (err instanceof ApiError && err.status === 401) {
        setError('קישור ההזמנה אינו תקף או שפג תוקפו. יש לבקש הזמנה חדשה ממנהל המערכת.');
        setLinkValid(false);
      } else {
        setError('ההפעלה נכשלה. יש לנסות שוב.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) return <div className="min-h-screen bg-background" />;

  if (!email || !token || !linkValid) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant p-8">
          <h1 className="font-headline-md text-headline-md text-on-surface mb-6">הפעלת חשבון</h1>
          <div className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">
            קישור ההזמנה אינו תקין, כבר נוצל, או שפג תוקפו (בתוקף ל-24 שעות). יש לבקש הזמנה חדשה ממנהל המערכת.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant p-8">
        <h1 className="font-headline-md text-headline-md text-on-surface mb-2">הפעלת חשבון</h1>
        <p className="font-body-sm text-body-sm text-on-surface-variant mb-6">קביעת סיסמה עבור {email}</p>
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
          <div className="mb-6">
            <label htmlFor="confirm-password" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
              אימות סיסמה
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2.5 border border-outline-variant rounded-DEFAULT text-body-md font-body-md text-on-surface bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-DEFAULT bg-primary text-on-primary font-title-sm text-title-sm hover:bg-primary-container hover:text-on-primary-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? '...' : 'הפעלת חשבון והתחברות'}
          </button>
        </form>
      </div>
    </div>
  );
}
