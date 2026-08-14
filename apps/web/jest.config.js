/** @type {import('jest').Config} */
module.exports = {
  // e2e/ is Playwright, not jest — @playwright/test's `import`/`test`/`expect` syntax and API are
  // incompatible with jest's own runner (Phase 2 UI plan Task 7.3). Run those via `pnpm test:e2e`.
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/e2e/'],
};
