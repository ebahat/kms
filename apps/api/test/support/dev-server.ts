/**
 * Phase 2 UI plan Task 7.2 — a real (if ephemeral) apps/api instance for manual/Playwright
 * testing of the new folder/group UI, since this sandbox has no live MongoDB Atlas connection
 * (same constraint every phase has had). Reuses buildTestApp()'s mongodb-memory-server +
 * ioredis-mock harness (Phase 2A's own Task 9), but calls `.listen()` instead of `.init()` so a
 * real Next.js dev server (apps/web, pointed at this harness with NEXT_PUBLIC_API_URL — see the
 * port note below) and a real browser can talk to it over HTTP.
 *
 * Seeds a real admin account with `mfaEnabled: true` and a real (KMS-envelope-encrypted, same as
 * production) TOTP secret — fixed by default (not random) so apps/web/e2e/folders-groups.spec.ts's
 * hardcoded secret keeps working against any freshly-booted harness (override via SEED_TOTP_SECRET
 * for an exploratory run); printed in plain to stdout either way so a human can compute a valid
 * code with otplib's `authenticator.generate(secret)` — skipping the A3 enrollment flow, which is
 * Phase 1 territory already covered elsewhere, not what this plan's golden path is testing.
 *
 * Run: pnpm --filter @kms/api exec ts-node --transpile-only -r tsconfig-paths/register test/support/dev-server.ts
 * Stays running until killed (Ctrl+C).
 *
 * Listens on 4000, not 3000 (changed 2026-08-21): this machine also runs an unrelated long-lived
 * process on :3000 for a different project, so the harness defaults to :4000 to avoid the
 * conflict. Point apps/web at it with NEXT_PUBLIC_API_URL=http://localhost:4000 when running
 * `next dev` for e2e work against this harness (folders-groups.spec.ts's baseURL for the web app
 * itself is unaffected — still :3010).
 */
import 'reflect-metadata';
import { ClsService } from 'nestjs-cls';
import { encryptField, hashPassword, LocalMasterKeyProvider } from '@kms/auth';
import { newObjectId, ChunksRepository, DocumentsRepository, SCOPE_CLS_KEY, TenantsRepository, UsersRepository } from '@kms/data';
import { FakeEmbeddingProvider } from '@kms/ai-providers';
import { buildTestApp } from './test-app';
import { seedFolder, seedGroup, withScope, scopeFor } from './fixtures';

const PORT = Number(process.env.DEV_HARNESS_PORT) || 4000;
const ADMIN_EMAIL = 'admin@dev-harness.test';
const ADMIN_PASSWORD = 'DevHarness#2026';
// Fixed by default (not generateTotpSecret()'s random output) so apps/web/e2e/folders-groups.spec.ts's
// hardcoded TOTP_SECRET keeps matching a freshly-booted harness — same repeatability rationale as
// ADMIN_EMAIL/ADMIN_PASSWORD above being fixed constants, not random per boot. SEED_TOTP_SECRET
// still overrides it for an exploratory manual run that wants a fresh one.
const ADMIN_TOTP_SECRET = process.env.SEED_TOTP_SECRET || 'ERVVGRZMM5NWYM2O';
const PEPPER = 'integration-test-pepper'; // matches TEST_PASSWORD_PEPPER in test-app.ts
const MASTER_KEY_HEX = '22'.repeat(32); // matches TEST_KMS_MASTER_KEY_HEX in test-app.ts

async function main() {
  // Dev-harness only. apps/api/src/main.ts enables no CORS at all, so a browser at :3010 cannot
  // call the API at this harness's port (4000 by default) — a cross-origin fetch fails before it
  // ever reaches a guard, and
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

  // 'llm' enabled so the chat screens (document-chat-rag plan) are reachable through this harness — every
  // other module stays off by default, matching this harness's prior behavior for calendar/kanban.
  const tenant = await tenants.create({ name: 'Dev Harness Tenant', edition: 'kb', storageQuotaBytes: 10 * 1024 * 1024 * 1024, featureToggles: ['llm'] });
  const tenantId = tenant._id;
  const placeholderId = newObjectId(); // scope.userId is unused by ScopedRepository.create()'s buildFilter — same trick as bootstrap/seed.ts

  const passwordHash = await hashPassword(ADMIN_PASSWORD, PEPPER);
  const totpSecret = ADMIN_TOTP_SECRET;
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

  // A real chunk for live chat verification (document-chat-rag plan, Part 2 Task 11) — seeded
  // directly, same as the chat integration test, since apps/worker's real ingestion pipeline isn't
  // running in this harness process (already proven live end-to-end separately, Part 1 Task 12).
  const chatDocumentId = newObjectId();
  const chatVersionId = newObjectId();
  const chatChunkText = 'ישיבת ההנהלה מיום שני אישרה תקציב שנתי בסך שני מיליון שקלים לפרויקט המעבר הדיגיטלי';
  const embedder = new FakeEmbeddingProvider();
  const [chatChunkEmbedding] = await embedder.embed([chatChunkText]);
  await withScope(cls, scopeFor(tenantId, adminId), async () => {
    // A real Document row so the citation click flow (GET /chat/citations/:chunkId) resolves a
    // real document name — no real upload/version bytes needed for this seeded chunk's own purpose.
    await ctx.app.get(DocumentsRepository).createDocument({
      id: chatDocumentId,
      folderId: rootPublic._id,
      name: 'פרוטוקול-ישיבת-הנהלה.pdf',
      latestVersionId: chatVersionId,
      createdBy: adminId,
    });
    await ctx.app.get(ChunksRepository).insertMany([
      {
        folderId: rootPublic._id,
        documentId: chatDocumentId,
        versionId: chatVersionId,
        seq: 0,
        text: chatChunkText,
        embedding: chatChunkEmbedding,
        embeddingModel: embedder.modelName,
        lang: 'he',
      },
    ]);
  });

  console.log(`\nDev harness API listening on http://localhost:${PORT}`);
  console.log(`Login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`TOTP secret (compute a live code with otplib's authenticator.generate): ${totpSecret}`);
  console.log(
    `Seeded: tenant=${tenantId.toString()}, public root=${rootPublic._id.toString()}, group-restricted folder=${restricted._id.toString()}, group=${group._id.toString()} (Sales)`,
  );
  console.log(`Chat: 1 chunk seeded under "Public Root" for "פרוטוקול-ישיבת-הנהלה.pdf" — ask about "התקציב השנתי" to see a real grounded, cited answer.`);
  console.log('Point apps/web at this instance (default NEXT_PUBLIC_API_URL already matches) and run its dev server separately.');
  console.log('Ctrl+C to stop.\n');
}

main().catch((err) => {
  console.error('Dev harness failed to start:', err);
  process.exit(1);
});
