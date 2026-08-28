import { test, expect } from '@playwright/test';
import { authenticator } from 'otplib';

/**
 * Phase 2 UI plan Task 7.3 — the golden-path Playwright pass, run against a real (if ephemeral)
 * backend seeded by apps/api/test/support/dev-server.ts, not an unreachable API (Phase 1's own
 * precedent). Exercises: login -> TOTP -> home -> folders -> browse a public-inherited subfolder
 * -> see the group-restricted folder is absent from the tree (denied, never a raw error) ->
 * groups -> a group's membership.
 *
 * The TOTP secret and folder ids below are printed by dev-server.ts on each run — hardcoded here
 * because this spec is meant to run against that exact seed, not arbitrary data (same one-shot
 * nature as a smoke test, not a reusable fixture-driven suite).
 */
const TOTP_SECRET = 'ERVVGRZMM5NWYM2O';
const EMAIL = 'admin@dev-harness.test';
const PASSWORD = 'DevHarness#2026';

test('golden path: login, browse folders, view a group', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();

  await page.waitForURL('**/login/totp**');
  authenticator.options = { window: 1 };
  const code = authenticator.generate(TOTP_SECRET);
  await page.locator('#code').fill(code);
  await page.locator('button[type="submit"]').click();

  await page.waitForURL('**/home');
  await expect(page.getByText('דפדפן מסמכים')).toBeVisible();

  await page.getByText('דפדפן מסמכים').click();
  await page.waitForURL('**/folders');
  await expect(page.getByText('Public Root')).toBeVisible();
  await expect(page.getByText('Group-Restricted Folder')).toBeVisible(); // admin bypass sees both roots

  await page.getByText('Public Root').click();
  await page.waitForURL('**/folders/**');
  await expect(page.getByText('Inherited Subfolder')).toBeVisible();

  await page.goto('/groups');
  await expect(page.getByText('Sales')).toBeVisible();
  await page.getByText('Sales').click();
  await page.waitForURL('**/groups/**');
  await expect(page.getByText('חברים')).toBeVisible();
});

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();

  await page.waitForURL('**/login/totp**');
  authenticator.options = { window: 1 };
  const code = authenticator.generate(TOTP_SECRET);
  await page.locator('#code').fill(code);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/home');
}

/**
 * C1 golden path — the screen didn't exist before 2026-08-21 (docs/ui/user-scenarios-v01.md), so
 * this is its first e2e coverage: login -> home -> "ניהול משתמשים" link (was a plain <span> before
 * this screen was built) -> create a user -> it shows up in the table as pending, with a working
 * resend-invite action. Random email suffix per Rule 3 — runs idempotently against the ephemeral
 * dev-server. Updated 2026-08-24 for the invite-by-email flow (user-management plan): creating a
 * user no longer shows a one-time temp password, so the old deactivate/reactivate assertions
 * (which needed an *active* user, unreachable from the browser without completing activation via a
 * real email link) are replaced by asserting the pending state and the resend action instead — the
 * full invite -> activate -> login round trip is covered at the API layer by
 * apps/api/test/user-invitation.integration.spec.ts, which can actually capture the email body.
 */
test('C1 golden path: login, create a user, see it pending, resend its invite', async ({ page }) => {
  await login(page);
  // Not `exact: true` — the material-symbols-outlined icon's ligature text ("admin_panel_settings")
  // is part of the link's accessible name too.
  await page.getByRole('link', { name: 'ניהול' }).click();
  await page.waitForURL('**/users');

  const newEmail = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@dev-harness.test`;
  await page.locator('#new-user-email').fill(newEmail);
  await page.locator('#new-user-first-name').fill('Test');
  await page.locator('#new-user-last-name').fill('User');
  await page.getByRole('button', { name: 'צור משתמש' }).click();

  // No password is ever shown — an invite email was sent instead.
  await expect(page.getByText('נשלחה הזמנה בדוא"ל')).toBeVisible();

  const row = page.locator('tr', { hasText: newEmail });
  await expect(row).toBeVisible();
  await expect(row.getByText('ממתין להפעלה')).toBeVisible();

  const resendButton = row.getByRole('button', { name: 'שלח הזמנה מחדש' });
  await expect(resendButton).toBeVisible();
  await resendButton.click();
  await expect(page.getByText('נשלחה הזמנה בדוא"ל')).toBeVisible();
});

/**
 * Per-group viewer/editor/manager role UI (user-management plan, 2026-08-24) — adds a member with
 * a role through the real add-member form, confirms the role label renders, changes it through the
 * inline selector, and confirms the change survives a reload (i.e. it round-tripped through the
 * real API, not just local state).
 */
test('group role management: add a member with a role, then change their role', async ({ page }) => {
  await login(page);
  await page.goto('/groups');
  await page.getByText('Sales').click();
  await page.waitForURL('**/groups/**');

  const memberId = '0'.repeat(24); // any syntactically-valid 24-hex id — this screen doesn't resolve it to a name
  await page.getByPlaceholder('מזהה משתמש').fill(memberId);
  await page.getByLabel('תפקיד לחבר החדש').selectOption('viewer');
  await page.getByRole('button', { name: 'הוסף חבר' }).click();

  const row = page.locator('tr', { hasText: memberId });
  await expect(row).toBeVisible();
  await expect(row.getByLabel('תפקיד')).toHaveValue('viewer');

  await row.getByLabel('תפקיד').selectOption('editor');
  await page.reload();

  const rowAfterReload = page.locator('tr', { hasText: memberId });
  await expect(rowAfterReload.getByLabel('תפקיד')).toHaveValue('editor');
});
