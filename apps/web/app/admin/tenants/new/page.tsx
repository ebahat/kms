'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiErrorMessage, portalApi } from '../../../../lib/api';
import { platformTenantsApi, ProvisionTenantResult } from '../../../../lib/platform-tenants-api';

type SubdomainCheck = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const DEBOUNCE_MS = 400;

/**
 * Superuser tenant + first-admin provisioning (Phase C, C1.5) — the form the original request
 * asked for: tenant name, subdomain, admin user, an option to upload a logo, and a theme color.
 * Two-step submit (docs/plans/superuser-subdomain-provisioning-22-08-2026-plan.md, C1.5): the
 * JSON tenant+admin create first, then — only if a logo file was chosen — a follow-up multipart
 * upload using the tenantId the first request returned. Real per-tenant subdomain *routing* is
 * separately-gated production infra (C2, not built here) — the subdomain saved by this form is
 * stored and validated for uniqueness now, but doesn't resolve to anything reachable yet.
 */
export default function NewTenantPage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [edition, setEdition] = useState<'kb' | 'ocr'>('kb');
  const [subdomain, setSubdomain] = useState('');
  const [subdomainCheck, setSubdomainCheck] = useState<SubdomainCheck>('idle');
  const [adminEmail, setAdminEmail] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [themeColor, setThemeColor] = useState('#060046');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionTenantResult | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Same "call something real, redirect on 401" auth guard app/admin/home/page.tsx uses — this
  // page has no GET of its own to piggyback on, since the form starts empty.
  useEffect(() => {
    portalApi.get('/platform-admin/tenants').catch(() => router.push('/admin/login'));
  }, [router]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const value = subdomain.trim().toLowerCase();
    if (!value) {
      setSubdomainCheck('idle');
      return;
    }
    if (!SUBDOMAIN_REGEX.test(value)) {
      setSubdomainCheck('invalid');
      return;
    }
    setSubdomainCheck('checking');
    debounceRef.current = setTimeout(async () => {
      try {
        const { available } = await platformTenantsApi.checkSubdomain(value);
        setSubdomainCheck(available ? 'available' : 'taken');
      } catch {
        setSubdomainCheck('idle'); // don't block submit on a check-endpoint hiccup — the real create call still validates
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [subdomain]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !subdomain.trim() || !adminEmail.trim()) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const provisioned = await platformTenantsApi.provision({
        name: name.trim(),
        edition,
        subdomain: subdomain.trim().toLowerCase(),
        adminEmail: adminEmail.trim(),
        themeColorRgb: themeColor,
      });
      if (logoFile) {
        try {
          await platformTenantsApi.uploadLogo(provisioned.tenantId, logoFile);
        } catch (e) {
          // Tenant + admin are already created — a failed logo upload is not fatal to the whole
          // operation, just surfaced separately so the superuser knows to retry it.
          setError(apiErrorMessage(e, 'הארגון נוצר, אך העלאת הלוגו נכשלה'));
        }
      }
      setResult(provisioned);
      setName('');
      setSubdomain('');
      setAdminEmail('');
      setLogoFile(null);
      setThemeColor('#060046');
    } catch (e) {
      if (e && typeof e === 'object' && 'body' in e && (e as { body?: { error?: string } }).body?.error === 'SUBDOMAIN_TAKEN') {
        setSubdomainCheck('taken');
      }
      setError(apiErrorMessage(e, 'יצירת הארגון נכשלה'));
    } finally {
      setSubmitting(false);
    }
  }

  const subdomainHint: Record<SubdomainCheck, string | null> = {
    idle: null,
    checking: 'בודק זמינות...',
    available: 'זמין',
    taken: 'תפוס',
    invalid: 'תווים לא חוקיים (a-z, 0-9, מקף)',
  };
  const subdomainHintColor: Record<SubdomainCheck, string> = {
    idle: 'text-on-surface-variant',
    checking: 'text-on-surface-variant',
    available: 'text-primary',
    taken: 'text-error',
    invalid: 'text-error',
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-surface-container shadow-sm flex justify-between items-center px-container-padding h-row-height-standard border-b border-outline-variant">
        <h1 className="font-headline-md text-headline-md text-primary">ארגון חדש</h1>
        <Link
          href="/admin/home"
          className="border border-outline-variant text-on-surface font-title-sm text-title-sm px-4 py-1.5 rounded-DEFAULT hover:bg-surface-container-high transition-colors"
        >
          חזרה לרשימת ארגונים
        </Link>
      </header>

      <main className="p-container-padding max-w-2xl mx-auto">
        {error && <p className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{error}</p>}

        {result && (
          <div className="border border-primary bg-primary-container/10 rounded-lg p-4 mb-6">
            <p className="font-body-sm text-body-sm text-on-surface mb-2">
              הארגון <strong>{result.subdomain}</strong> נוצר, עם מנהל <strong>{result.adminEmail}</strong>.
              הסיסמה הזמנית מוצגת פעם אחת בלבד — יש להעביר אותה למנהל בנפרד:
            </p>
            <p className="font-code-sm text-code-sm bg-surface-container-low rounded-DEFAULT px-3 py-2 inline-block mb-2">{result.tempPassword}</p>
            <p className="font-label-xs text-label-xs text-on-surface-variant">
              תת-דומיין תקין ({result.subdomain}) נשמר, אך אינו נגיש עדיין — ניתוב תת-דומיינים אמיתי טרם הופעל.
            </p>
            <div>
              <button onClick={() => setResult(null)} className="text-primary hover:underline font-label-xs text-label-xs mt-2">
                סגור
              </button>
            </div>
          </div>
        )}

        <form onSubmit={onSubmit} className="bg-surface-container-lowest rounded-lg border border-outline-variant p-6 shadow-sm flex flex-col gap-4">
          <div>
            <label htmlFor="tenant-name" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
              שם הארגון
            </label>
            <input
              id="tenant-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-outline-variant rounded-DEFAULT text-body-sm font-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label htmlFor="tenant-edition" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
              מהדורה
            </label>
            <select
              id="tenant-edition"
              value={edition}
              onChange={(e) => setEdition(e.target.value as 'kb' | 'ocr')}
              className="w-full bg-surface border border-outline-variant rounded-DEFAULT py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="kb">בסיס ידע</option>
              <option value="ocr">OCR חכם</option>
            </select>
          </div>

          <div>
            <label htmlFor="tenant-subdomain" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
              תת-דומיין
            </label>
            <div className="flex items-center gap-2">
              <input
                id="tenant-subdomain"
                dir="ltr"
                required
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                placeholder="acme"
                className="flex-1 px-3 py-2 border border-outline-variant rounded-DEFAULT text-body-sm font-code-sm text-code-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <span className="font-body-sm text-body-sm text-on-surface-variant">.app.example.com</span>
            </div>
            {subdomainHint[subdomainCheck] && (
              <p className={`font-label-xs text-label-xs mt-1 ${subdomainHintColor[subdomainCheck]}`}>{subdomainHint[subdomainCheck]}</p>
            )}
          </div>

          <div>
            <label htmlFor="tenant-admin-email" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
              דוא&quot;ל מנהל
            </label>
            <input
              id="tenant-admin-email"
              type="email"
              required
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              className="w-full px-3 py-2 border border-outline-variant rounded-DEFAULT text-body-sm font-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label htmlFor="tenant-logo" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
              לוגו (אופציונלי — PNG/JPG)
            </label>
            <input
              id="tenant-logo"
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
              className="w-full font-body-sm text-body-sm text-on-surface-variant"
            />
          </div>

          <div>
            <label htmlFor="tenant-theme-color" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
              צבע ראשי
            </label>
            <div className="flex items-center gap-2">
              <input
                id="tenant-theme-color"
                type="color"
                value={themeColor}
                onChange={(e) => setThemeColor(e.target.value)}
                className="h-9 w-16 border border-outline-variant rounded-DEFAULT bg-surface cursor-pointer"
              />
              <span dir="ltr" className="font-code-sm text-code-sm text-on-surface-variant">
                {themeColor}
              </span>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !name.trim() || !subdomain.trim() || !adminEmail.trim() || subdomainCheck === 'taken' || subdomainCheck === 'invalid'}
            className="mt-2 bg-primary text-on-primary font-title-sm text-title-sm py-2 px-4 rounded-DEFAULT flex items-center justify-center gap-2 hover:bg-primary-container hover:text-on-primary-container transition-colors disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-sm">domain_add</span>
            צור ארגון
          </button>
        </form>
      </main>
    </div>
  );
}
