'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiErrorMessage, portalApi } from '../../../../lib/api';
import { platformTenantsApi, TenantAdminSummary, TenantDetail } from '../../../../lib/platform-tenants-api';

type SubdomainCheck = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const DEBOUNCE_MS = 400;
const STATUS_LABEL: Record<TenantDetail['status'], string> = { active: 'פעיל', suspended: 'מושעה' };

/**
 * Edit an existing organization + reset a tenant admin's password (2026-08-22, a direct follow-up
 * to the superuser provisioning screen). Subdomain editing is included and validated exactly like
 * at creation time, but — same as the new-tenant form — it's stored metadata only until C2 (real
 * subdomain routing) exists.
 */
export default function TenantDetailPage() {
  const params = useParams<{ id: string }>();
  const tenantId = params.id;
  const router = useRouter();

  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [edition, setEdition] = useState<'kb' | 'ocr'>('kb');
  const [subdomain, setSubdomain] = useState('');
  const [subdomainCheck, setSubdomainCheck] = useState<SubdomainCheck>('idle');
  const [themeColor, setThemeColor] = useState('#060046');
  const [logoFile, setLogoFile] = useState<File | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [busyStatus, setBusyStatus] = useState(false);

  const [admins, setAdmins] = useState<TenantAdminSummary[] | null>(null);
  const [adminsError, setAdminsError] = useState<string | null>(null);
  const [resetBusyId, setResetBusyId] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ email: string; tempPassword: string } | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setNotFound(false);
    setLoadError(null);
    try {
      const t = await platformTenantsApi.get(tenantId);
      setTenant(t);
      setName(t.name);
      setEdition(t.edition);
      setSubdomain(t.subdomain ?? '');
      setThemeColor(t.themeColorRgb ?? '#060046');
    } catch (e) {
      if (e && typeof e === 'object' && 'status' in e && (e as { status?: number }).status === 401) {
        router.push('/admin/login');
        return;
      }
      if (e && typeof e === 'object' && 'status' in e && (e as { status?: number }).status === 404) {
        setNotFound(true);
        return;
      }
      setLoadError(apiErrorMessage(e, 'שגיאה בטעינת הארגון'));
    }
  }, [tenantId, router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    portalApi
      .get<TenantAdminSummary[]>(`/platform-admin/tenants/${tenantId}/admins`)
      .then(setAdmins)
      .catch((e) => setAdminsError(apiErrorMessage(e, 'שגיאה בטעינת מנהלים')));
  }, [tenantId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const value = subdomain.trim().toLowerCase();
    if (!value) {
      setSubdomainCheck('idle');
      return;
    }
    if (tenant?.subdomain && value === tenant.subdomain) {
      setSubdomainCheck('idle'); // unchanged — nothing to check
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
        setSubdomainCheck('idle');
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [subdomain, tenant]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const trimmedSubdomain = subdomain.trim().toLowerCase();
      const updated = await platformTenantsApi.update(tenantId, {
        name: name.trim(),
        edition,
        // Omitted (not '') when unset — a tenant with no subdomain (e.g. one predating this field)
        // must not have its every other edit rejected by re-submitting an empty, invalid value; the
        // backend already treats an absent `subdomain` as "leave unchanged" (2026-08-30 fix).
        subdomain: trimmedSubdomain ? trimmedSubdomain : undefined,
        themeColorRgb: themeColor,
      });
      if (logoFile) {
        try {
          await platformTenantsApi.uploadLogo(tenantId, logoFile);
        } catch (e) {
          setSaveError(apiErrorMessage(e, 'הפרטים נשמרו, אך העלאת הלוגו נכשלה'));
        }
      }
      setTenant(await platformTenantsApi.get(tenantId));
      void updated;
      setLogoFile(null);
      setSaveOk(true);
    } catch (e) {
      if (e && typeof e === 'object' && 'body' in e && (e as { body?: { error?: string } }).body?.error === 'SUBDOMAIN_TAKEN') {
        setSubdomainCheck('taken');
      }
      setSaveError(apiErrorMessage(e, 'שמירת השינויים נכשלה'));
    } finally {
      setSaving(false);
    }
  }

  async function onToggleStatus() {
    if (!tenant) return;
    setBusyStatus(true);
    try {
      if (tenant.status === 'active') await platformTenantsApi.suspend(tenantId);
      else await platformTenantsApi.reactivate(tenantId);
      await load();
    } catch (e) {
      setSaveError(apiErrorMessage(e, 'הפעולה נכשלה'));
    } finally {
      setBusyStatus(false);
    }
  }

  async function onResetPassword(admin: TenantAdminSummary) {
    setResetBusyId(admin.id);
    setAdminsError(null);
    setResetResult(null);
    try {
      const { tempPassword } = await platformTenantsApi.resetAdminPassword(tenantId, admin.id);
      setResetResult({ email: admin.email, tempPassword });
    } catch (e) {
      setAdminsError(apiErrorMessage(e, 'איפוס הסיסמה נכשל'));
    } finally {
      setResetBusyId(null);
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
        <h1 className="font-headline-md text-headline-md text-primary">{tenant ? tenant.name : 'ארגון'}</h1>
        <Link
          href="/admin/home"
          className="border border-outline-variant text-on-surface font-title-sm text-title-sm px-4 py-1.5 rounded-DEFAULT hover:bg-surface-container-high transition-colors"
        >
          חזרה לרשימת ארגונים
        </Link>
      </header>

      <main className="p-container-padding max-w-2xl mx-auto">
        {loadError && <p className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{loadError}</p>}

        {notFound ? (
          <p className="font-body-md text-body-md text-on-surface-variant">הארגון לא נמצא.</p>
        ) : !tenant ? (
          <p className="font-body-md text-body-md text-on-surface-variant">טוען...</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <span
                className={`font-label-xs text-label-xs px-2 py-0.5 rounded-full ${tenant.status === 'active' ? 'bg-secondary-container text-on-secondary-container' : 'bg-error-container text-on-error-container'}`}
              >
                {STATUS_LABEL[tenant.status]}
              </span>
              <button
                onClick={onToggleStatus}
                disabled={busyStatus}
                className="border border-outline-variant text-on-surface font-title-sm text-title-sm px-4 py-1.5 rounded-DEFAULT hover:bg-surface-container-high transition-colors disabled:opacity-60"
              >
                {tenant.status === 'active' ? 'השעה ארגון' : 'הפעל ארגון מחדש'}
              </button>
            </div>

            {saveError && <p className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{saveError}</p>}
            {saveOk && <p className="bg-primary-container/10 border border-primary text-on-surface rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">השינויים נשמרו.</p>}

            <form onSubmit={onSave} className="bg-surface-container-lowest rounded-lg border border-outline-variant p-6 shadow-sm flex flex-col gap-4 mb-6">
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
                <label htmlFor="tenant-logo" className="block font-label-xs text-label-xs text-on-surface-variant mb-1">
                  לוגו (PNG/JPG)
                </label>
                <div className="flex items-center gap-3">
                  {tenant.logoUrl ? (
                    // Plain <img>, not next/image: signed URL is short-lived (5 min, ADR-0006), not a build-time-known static asset.
                    <img src={tenant.logoUrl} alt="" className="w-10 h-10 rounded-lg object-contain bg-surface-container-low border border-outline-variant" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-surface-container-low border border-outline-variant flex items-center justify-center text-on-surface-variant shrink-0">
                      <span className="material-symbols-outlined text-[18px]">domain</span>
                    </div>
                  )}
                  <input
                    id="tenant-logo"
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                    className="flex-1 font-body-sm text-body-sm text-on-surface-variant"
                  />
                </div>
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
                disabled={saving || !name.trim() || subdomainCheck === 'taken' || subdomainCheck === 'invalid'}
                className="mt-2 bg-primary text-on-primary font-title-sm text-title-sm py-2 px-4 rounded-DEFAULT flex items-center justify-center gap-2 hover:bg-primary-container hover:text-on-primary-container transition-colors disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-sm">save</span>
                שמור שינויים
              </button>
            </form>

            <div className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-sm overflow-hidden">
              <div className="p-4 border-b border-outline-variant bg-surface-container-low flex items-center gap-2">
                <span className="material-symbols-outlined text-on-surface-variant">admin_panel_settings</span>
                <h3 className="font-title-sm text-title-sm text-on-surface">מנהלי הארגון</h3>
              </div>

              {resetResult && (
                <div className="border-b border-outline-variant bg-primary-container/10 p-4">
                  <p className="font-body-sm text-body-sm text-on-surface mb-2">
                    הסיסמה של <strong>{resetResult.email}</strong> אופסה. הסיסמה הזמנית מוצגת פעם אחת בלבד — יש להעביר אותה למנהל בנפרד:
                  </p>
                  <p className="font-code-sm text-code-sm bg-surface-container-low rounded-DEFAULT px-3 py-2 inline-block mb-2">{resetResult.tempPassword}</p>
                  <div>
                    <button onClick={() => setResetResult(null)} className="text-primary hover:underline font-label-xs text-label-xs">
                      סגור
                    </button>
                  </div>
                </div>
              )}

              {adminsError && <p className="bg-error-container text-on-error-container px-4 py-2.5 font-body-sm text-body-sm">{adminsError}</p>}

              {admins === null ? (
                <p className="font-body-sm text-body-sm text-on-surface-variant p-4">טוען...</p>
              ) : admins.length === 0 ? (
                <p className="font-body-sm text-body-sm text-on-surface-variant p-4">אין מנהלים לארגון זה.</p>
              ) : (
                <table className="w-full text-right border-collapse">
                  <tbody className="font-body-sm text-body-sm text-on-surface divide-y divide-outline-variant">
                    {admins.map((a) => (
                      <tr key={a.id} className="hover:bg-surface-container-high transition-colors">
                        <td className="py-2 px-4 font-code-sm text-code-sm text-on-surface-variant">{a.email}</td>
                        <td className="py-2 px-4 text-center w-40">
                          <button
                            onClick={() => onResetPassword(a)}
                            disabled={resetBusyId === a.id}
                            className="border border-outline-variant text-on-surface font-label-xs text-label-xs px-3 py-1 rounded-DEFAULT hover:bg-surface-container-high transition-colors disabled:opacity-60"
                          >
                            אפס סיסמה
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
