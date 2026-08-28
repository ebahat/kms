/**
 * TEMPORARY, untracked demo harness — boots apps/api (:4000) and apps/portal-api (:4100) in one
 * process against a shared mongodb-memory-server + ioredis-mock, seeds a platform admin, so the
 * user can browse the new Phase C1 screens locally. Not part of the repo; delete when done.
 */
import 'reflect-metadata';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import RedisMock from 'ioredis-mock';
import { encryptField, generateTotpSecret, hashPassword, LocalMasterKeyProvider } from '@kms/auth';
import { FakeStorageProvider } from '@kms/storage';

const MASTER_KEY_HEX = '22'.repeat(32);
// Demo-only: apps/api and apps/portal-api each get their own STORAGE_PROVIDER binding in real
// deployments (two containers pointed at the same real bucket via shared env vars — see
// deploy/docker-compose.yml). Sharing one FakeStorageProvider *instance* here reproduces that
// "same underlying bucket" property for this single-process demo, so a logo uploaded via
// portal-api is actually visible when apps/api signs a URL for it.
const sharedStorage = new FakeStorageProvider();
const PEPPER = 'integration-test-pepper';
const ADMIN_EMAIL = 'superuser@dev-harness.test';
const ADMIN_PASSWORD = 'DevHarness#2026';

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  process.env.KMS_MASTER_KEY_HEX = MASTER_KEY_HEX;
  process.env.PASSWORD_PEPPER = PEPPER;
  delete process.env.GCS_DATA_BUCKET;
  delete process.env.RESEND_API_KEY;

  const { AppModule: ApiAppModule } = await import('/Users/ehud/workspace/kms/apps/api/src/app.module');
  const { REDIS_APP_CLIENT: ApiRedisToken } = await import('/Users/ehud/workspace/kms/apps/api/src/redis.provider');
  const apiModuleRef = await Test.createTestingModule({ imports: [ApiAppModule] })
    .overrideProvider(ApiRedisToken)
    .useValue(new RedisMock())
    .overrideProvider('STORAGE_PROVIDER')
    .useValue(sharedStorage)
    .compile();
  const apiApp = apiModuleRef.createNestApplication<NestExpressApplication>();
  apiApp.use(cookieParser());
  apiApp.enableCors({ origin: 'http://localhost:3010', credentials: true });
  await apiApp.init();
  await apiApp.listen(4000);

  const { AppModule: PortalAppModule } = await import('/Users/ehud/workspace/kms/apps/portal-api/src/app.module');
  const { REDIS_APP_CLIENT: PortalRedisToken } = await import('/Users/ehud/workspace/kms/apps/portal-api/src/redis.provider');
  const portalModuleRef = await Test.createTestingModule({ imports: [PortalAppModule] })
    .overrideProvider(PortalRedisToken)
    .useValue(new RedisMock())
    .overrideProvider('STORAGE_PROVIDER')
    .useValue(sharedStorage)
    .compile();
  const portalApp = portalModuleRef.createNestApplication<NestExpressApplication>();
  portalApp.use(cookieParser());
  portalApp.enableCors({ origin: 'http://localhost:3010', credentials: true });
  await portalApp.init();
  await portalApp.listen(4100);

  const { PlatformAdminsRepository } = await import('@kms/data');
  const admins = portalApp.get(PlatformAdminsRepository);
  const passwordHash = await hashPassword(ADMIN_PASSWORD, PEPPER);
  const totpSecret = generateTotpSecret();
  const totpSecretEnvelope = await encryptField(totpSecret, new LocalMasterKeyProvider(MASTER_KEY_HEX));
  const admin = await admins.create({ email: ADMIN_EMAIL, passwordHash });
  await admins.updateOne(admin._id, { $set: { mfaEnabled: true, totpSecretEnvelope } });

  console.log(`\napps/api listening on http://localhost:4000`);
  console.log(`apps/portal-api listening on http://localhost:4100`);
  console.log(`Platform admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`TOTP secret: ${totpSecret}`);
  console.log('Ctrl+C to stop.\n');
}

main().catch((err) => {
  console.error('Demo dual harness failed to start:', err);
  process.exit(1);
});
