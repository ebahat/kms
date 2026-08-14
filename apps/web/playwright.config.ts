import { defineConfig } from '@playwright/test';

/**
 * Phase 2 UI plan Task 7.3. `baseURL` assumes `next dev -p 3010` and
 * apps/api/test/support/dev-server.ts (or an equivalent seeded backend) are already running —
 * this config does not manage either server's lifecycle itself, matching how the plan's own dev
 * harness is meant to be started manually/by a script, not auto-spawned per test run.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3010',
  },
});
