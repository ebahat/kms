/** @type {import('jest').Config} */
module.exports = {
  // e2e/ is Playwright, not jest — @playwright/test's `import`/`test`/`expect` syntax and API are
  // incompatible with jest's own runner (Phase 2 UI plan Task 7.3). Run those via `pnpm test:e2e`.
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/e2e/'],
  // testPathIgnorePatterns only governs which files jest treats as tests — haste-map's module
  // scan still walks `.next/` regardless, which races a concurrent `next build` writing/deleting
  // files there (hit when turbo runs build/lint/test:unit for this package in parallel) and throws
  // ENOENT on `.next/package.json`. modulePathIgnorePatterns excludes it from that scan entirely.
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
};
