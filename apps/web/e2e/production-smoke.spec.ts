import { expect, test } from '@playwright/test';

/**
 * Post-deploy smoke test — runs a REAL browser against a REAL deployment.
 *
 * Why this exists (2026-08-21 retro): the pre-existing e2e suite
 * (`folders-groups.spec.ts`) runs against `next dev` on localhost, where
 * `NEXT_PUBLIC_API_URL` is unset and falls back to `http://localhost:3000` —
 * effectively same-origin. Production served the UI on `app.<domain>` and the
 * API on `api.<domain>`, which is CROSS-origin. So the suite that looked like
 * the safety net was structurally incapable of catching the two bugs that
 * actually broke every single production login:
 *
 *   1. no CORS anywhere in apps/api -> the browser's preflight
 *      (`OPTIONS /auth/login`) 404s and the real POST is never sent; and
 *   2. `__Host-kms_sess` is host-pinned by construction (ADR-0004 / sec §2),
 *      so a cookie set by api.<domain> can never be sent by app.<domain>.
 *
 * Both were fixed by routing the API under the SAME origin (`/api/*` via
 * Caddy's `handle_path`). This test is what proves that stays true: it drives
 * the actual login form in a real browser and asserts a usable session results.
 * It fails if anyone reintroduces a cross-origin split, breaks the Caddy route,
 * or ships a `web` image built without the right `NEXT_PUBLIC_*` build args.
 *
 * Run against a deployment:
 *   SMOKE_BASE_URL=https://app.bahat.co.il \
 *   SMOKE_EMAIL=... SMOKE_PASSWORD=... \
 *   pnpm --filter @kms/web exec playwright test e2e/production-smoke.spec.ts
 *
 * Skips itself (rather than failing) when those aren't set, so it never breaks
 * a normal local `test:e2e` run.
 */

const BASE_URL = process.env.SMOKE_BASE_URL;
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;

test.describe('production smoke', () => {
  test.skip(!BASE_URL || !EMAIL || !PASSWORD, 'SMOKE_BASE_URL/SMOKE_EMAIL/SMOKE_PASSWORD not set');
  // Real network + real TLS + a real Argon2id verify on the server: slower than a local run.
  test.setTimeout(60_000);

  /**
   * MUST-NOT-MUTATE guard. A successful login redirects to `/login/totp`, and when the account
   * isn't enrolled yet the URL carries `?enroll=1` — which makes that page fire
   * `POST /auth/totp/enroll` automatically on mount. That endpoint is destructive: it generates a
   * new TOTP secret, overwrites any existing one, flips `mfaEnabled` to true, and returns the QR +
   * backup codes exactly once.
   *
   * The first version of this file did not block it, and running it against the real deployment
   * silently enrolled the operator's own account with a secret that only ever existed inside a
   * headless browser — locking them out of their own MFA (2026-08-21). A post-deploy smoke test
   * runs against production by definition, so it must be strictly non-mutating.
   *
   * Aborting the request still lets every assertion below hold: the redirect, the session cookie,
   * and credential acceptance all happen server-side before this endpoint is ever reached.
   */
  test.beforeEach(async ({ page }) => {
    await page.route('**/auth/totp/enroll', (route) => route.abort());
  });

  test('login page is served over valid TLS with no console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const res = await page.goto(`${BASE_URL}/login`);
    expect(res?.status()).toBe(200);
    // Hebrew-first, RTL (PRD §10) — asserts we got the real app, not an error page.
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'כניסה' })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('the API is same-origin — no cross-origin request is ever attempted', async ({ page }) => {
    const appOrigin = new URL(BASE_URL!).origin;
    const crossOrigin: string[] = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      // Ignore non-http(s) (data:, blob:) — only real network egress matters here.
      if (url.protocol.startsWith('http') && url.origin !== appOrigin) crossOrigin.push(req.url());
    });

    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel('דוא"ל').fill(EMAIL!);
    await page.getByLabel('סיסמה').fill(PASSWORD!);
    await page.getByRole('button', { name: 'כניסה' }).click();
    await page.waitForURL(/\/login\/totp/, { timeout: 30_000 });

    // The exact regression that broke production: any absolute api.<domain> call here means the
    // bundle was built with the wrong NEXT_PUBLIC_API_URL and CORS/__Host- cookies will break.
    expect(crossOrigin).toEqual([]);
  });

  test('a real login succeeds and issues a usable __Host- session cookie', async ({ page, context }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel('דוא"ל').fill(EMAIL!);
    await page.getByLabel('סיסמה').fill(PASSWORD!);
    await page.getByRole('button', { name: 'כניסה' }).click();

    // MFA is mandatory (TOTP-only, SMS deferred) — a correct login lands on the TOTP step,
    // NOT on an error. Asserting the destination proves credentials were actually accepted.
    await page.waitForURL(/\/login\/totp/, { timeout: 30_000 });
    await expect(page.locator('.auth-error')).toHaveCount(0);

    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === '__Host-kms_sess');
    expect(session, 'tenant session cookie must be set').toBeTruthy();
    // __Host- prefix rules (sec §2): Secure, Path=/, and NO Domain attribute.
    expect(session!.secure).toBe(true);
    expect(session!.path).toBe('/');
    expect(session!.httpOnly).toBe(true);
    expect(new URL(BASE_URL!).hostname).toBe(session!.domain.replace(/^\./, ''));
  });

  test('wrong password is rejected in the browser, not silently swallowed', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel('דוא"ל').fill(EMAIL!);
    await page.getByLabel('סיסמה').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'כניסה' }).click();

    // Must show the error AND stay put. Before the same-origin fix this looked identical to a
    // CORS failure — which is exactly why "shows an error" alone was never sufficient proof.
    await expect(page.locator('.auth-error')).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/login$/);
  });
});
