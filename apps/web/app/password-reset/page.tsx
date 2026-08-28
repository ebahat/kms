'use client';

import { useState } from 'react';
import { tenantApi } from '../../lib/api';

/**
 * Backend response is identical whether or not the email exists (enumeration resistance, sec §2)
 * — this page must never reveal which case happened, so there's only one success state.
 */
export default function PasswordResetRequestPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await tenantApi.post('/auth/password-reset/request', { email });
    } finally {
      // Always show the same success state, even on a network error — otherwise the failure
      // mode itself would leak whether the email exists (a slow/failed request vs. a fast one).
      setSubmitting(false);
      setSubmitted(true);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant p-8">
        <h1 className="font-headline-md text-headline-md text-on-surface mb-6">איפוס סיסמה</h1>
        {submitted ? (
          <p className="font-body-md text-body-md text-on-surface">אם קיים חשבון עם דוא&quot;ל זה, נשלח אליו קישור לאיפוס הסיסמה.</p>
        ) : (
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
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-DEFAULT bg-primary text-on-primary font-title-sm text-title-sm hover:bg-primary-container hover:text-on-primary-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? '...' : 'שלח קישור לאיפוס'}
            </button>
          </form>
        )}
        <div className="font-body-sm text-body-sm text-on-surface-variant mt-4">
          <a href="/login" className="text-primary hover:underline">
            חזרה לכניסה
          </a>
        </div>
      </div>
    </div>
  );
}
