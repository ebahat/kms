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

/** Tenant realm (apps/api). */
export const tenantApi = {
  get: <T>(path: string) => request<T>(API_BASE, path, { method: 'GET' }),
  post: <T>(path: string, data?: unknown) => request<T>(API_BASE, path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
};

/** Platform-admin realm (apps/portal-api) — the admin-hostname UI area (ADR-0004). */
export const portalApi = {
  get: <T>(path: string) => request<T>(PORTAL_API_BASE, path, { method: 'GET' }),
  post: <T>(path: string, data?: unknown) =>
    request<T>(PORTAL_API_BASE, path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
};
