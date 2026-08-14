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
  await expect(page.getByText('תיקיות')).toBeVisible();

  await page.getByText('תיקיות').click();
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
