const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
const PORTAL_API_BASE = process.env.NEXT_PUBLIC_PORTAL_API_URL ?? 'http://localhost:3100';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(typeof body === 'object' && body && 'error' in body ? String((body as { error: unknown }).error) : `HTTP ${status}`);
  }
}

/** Every call sends the httpOnly session cookie (ADR-0004) — never reads/writes it from JS. */
async function request<T>(base: string, path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  const body = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (res.status === 451 && typeof window !== 'undefined') {
    // TosGateGuard (ADR-0004): route to the blocking acceptance interstitial regardless of which call triggered it.
    window.location.href = '/tos-accept';
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

/** Builds a query string from defined values only — `undefined`/`null` params are omitted, not sent as `"undefined"`. */
export function toQuery(params: Record<string, string | undefined | null>): string {
  const entries = Object.entries(params).filter((entry): entry is [string, string] => entry[1] != null);
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries).toString()}`;
}

/**
 * Every FolderExceptionFilter-mapped error body is `{error: CODE, message: humanReadableText}` —
 * `ApiError#message` itself resolves to `CODE` (existing behavior `login/page.tsx` relies on to
 * branch on `err.body.error === 'CAPTCHA_REQUIRED'`, deliberately left unchanged here). This helper
 * is for screens that want to show the backend's own human-readable text instead of curating
 * per-error-code Hebrew copy for every possible domain error (FOLDER_NOT_EMPTY, GROUP_IN_USE, etc).
 */
export function apiErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.body && typeof e.body === 'object' && 'message' in e.body && typeof (e.body as { message: unknown }).message === 'string') {
      return (e.body as { message: string }).message;
    }
    return fallback;
  }
  return fallback;
}

/** Tenant realm (apps/api). */
export const tenantApi = {
  get: <T>(path: string) => request<T>(API_BASE, path, { method: 'GET' }),
  post: <T>(path: string, data?: unknown) => request<T>(API_BASE, path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) => request<T>(API_BASE, path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  del: <T>(path: string, data?: unknown) => request<T>(API_BASE, path, { method: 'DELETE', body: data ? JSON.stringify(data) : undefined }),
  postForm: <T>(path: string, form: FormData) => requestForm<T>(API_BASE, path, form),
};

/**
 * Multipart POST — deliberately bypasses request()'s JSON Content-Type header (the browser sets
 * its own `multipart/form-data; boundary=...` for a FormData body; overriding it manually breaks
 * the boundary). Used only by the superuser tenant-logo upload (Phase C, C1.5) so far.
 */
async function requestForm<T>(base: string, path: string, form: FormData): Promise<T> {
  const res = await fetch(`${base}${path}`, { method: 'POST', credentials: 'include', body: form });
  const body = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

/** Platform-admin realm (apps/portal-api) — the admin-hostname UI area (ADR-0004). */
export const portalApi = {
  get: <T>(path: string) => request<T>(PORTAL_API_BASE, path, { method: 'GET' }),
  post: <T>(path: string, data?: unknown) =>
    request<T>(PORTAL_API_BASE, path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(PORTAL_API_BASE, path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  postForm: <T>(path: string, form: FormData) => requestForm<T>(PORTAL_API_BASE, path, form),
};
