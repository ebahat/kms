/**
 * Phase 2 UI plan Task 7.2 — a real (if ephemeral) apps/api instance for manual/Playwright
 * testing of the new folder/group UI, since this sandbox has no live MongoDB Atlas connection
 * (same constraint every phase has had). Reuses buildTestApp()'s mongodb-memory-server +
 * ioredis-mock harness (Phase 2A's own Task 9), but calls `.listen()` instead of `.init()` so a
 * real Next.js dev server (apps/web, default NEXT_PUBLIC_API_URL=http://localhost:3000) and a
 * real browser can talk to it over HTTP.
 *
 * Seeds a real admin account with `mfaEnabled: true` and a real (KMS-envelope-encrypted, same as
 * production) TOTP secret — printed in plain to stdout so a human or a Playwright script can
 * compute a valid code with otplib's `authenticator.generate(secret)` — skipping the A3
 * enrollment flow, which is Phase 1 territory already covered elsewhere, not what this plan's
 * golden path is testing.
 *
 * Run: pnpm --filter @kms/api exec ts-node -r tsconfig-paths/register test/support/dev-server.ts
 * Stays running until killed (Ctrl+C).
 */
import 'reflect-metadata';
import { ClsService } from 'nestjs-cls';
import { encryptField, generateTotpSecret, hashPassword, LocalMasterKeyProvider } from '@kms/auth';
import { newObjectId, SCOPE_CLS_KEY, TenantsRepository, UsersRepository } from '@kms/data';
import { buildTestApp } from './test-app';
import { seedFolder, seedGroup } from './fixtures';

const PORT = 3000;
const ADMIN_EMAIL = 'admin@dev-harness.test';
const ADMIN_PASSWORD = 'DevHarness#2026';
const PEPPER = 'integration-test-pepper'; // matches TEST_PASSWORD_PEPPER in test-app.ts
const MASTER_KEY_HEX = '22'.repeat(32); // matches TEST_KMS_MASTER_KEY_HEX in test-app.ts

async function main() {
  // Dev-harness only. apps/api/src/main.ts enables no CORS at all, so a browser at :3010 cannot
  // call the API at :3000 — a cross-origin fetch fails before it ever reaches a guard, and
  // login/page.tsx's catch-all renders that as "wrong email or password", which is genuinely
  // misleading during local UI work. Whether production needs real CORS depends on whether
  // apps/web and apps/api end up same-origin behind the Cloud Run/LB mapping (ADR-0007) — an
  // open deployment question, NOT decided here. Recorded in the Task 7 report rather than
  // silently patching src/main.ts.
  const ctx = await buildTestApp({ corsOrigin: 'http://localhost:3010' });
  await ctx.app.listen(PORT);

  const cls = ctx.app.get(ClsService);
  const tenants = ctx.app.get(TenantsRepository);
  const users = ctx.app.get(UsersRepository);

  const tenant = await tenants.create({ name: 'Dev Harness Tenant', edition: 'kb', storageQuotaBytes: 10 * 1024 * 1024 * 1024, featureToggles: [] });
  const tenantId = tenant._id;
  const placeholderId = newObjectId(); // scope.userId is unused by ScopedRepository.create()'s buildFilter — same trick as bootstrap/seed.ts

  const passwordHash = await hashPassword(ADMIN_PASSWORD, PEPPER);
  const totpSecret = generateTotpSecret();
  const totpSecretEnvelope = await encryptField(totpSecret, new LocalMasterKeyProvider(MASTER_KEY_HEX));

  const admin = await cls.run(async () => {
    cls.set(SCOPE_CLS_KEY, { tenantId, userId: placeholderId, role: 'admin' as const, edition: 'kb' as const });
    return users.create({
      email: ADMIN_EMAIL,
      passwordHash,
      role: 'admin',
      status: 'active',
      mfaEnabled: true,
      totpSecretEnvelope,
      totpBackupCodeHashes: [],
    });
  });
  const adminId = admin._id;

  const rootPublic = await seedFolder(ctx.app, { tenantId, name: 'Public Root', isPublic: true });
  await seedFolder(ctx.app, { tenantId, parentId: rootPublic._id, name: 'Inherited Subfolder' });
  const group = await seedGroup(ctx.app, { tenantId, memberUserIds: [adminId], name: 'Sales' });
  const restricted = await seedFolder(ctx.app, {
    tenantId,
    name: 'Group-Restricted Folder',
    grants: [{ principalType: 'group', principalId: group._id, access: 'edit' }],
  });

  console.log(`\nDev harness API listening on http://localhost:${PORT}`);
  console.log(`Login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`TOTP secret (compute a live code with otplib's authenticator.generate): ${totpSecret}`);
  console.log(
    `Seeded: tenant=${tenantId.toString()}, public root=${rootPublic._id.toString()}, group-restricted folder=${restricted._id.toString()}, group=${group._id.toString()} (Sales)`,
  );
  console.log('Point apps/web at this instance (default NEXT_PUBLIC_API_URL already matches) and run its dev server separately.');
  console.log('Ctrl+C to stop.\n');
}

main().catch((err) => {
  console.error('Dev harness failed to start:', err);
  process.exit(1);
});
