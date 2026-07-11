import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { hashPassword } from '@kms/auth';
import { SCOPE_CLS_KEY, TenantsRepository, UsersRepository } from '@kms/data';
import { AppModule } from '../app.module';

/**
 * One-time bootstrap: creates the first tenant + its first admin user.
 * No SystemScope needed — TenantsRepository isn't scoped at all, and the
 * user create runs inside a CLS scope this script sets itself (it IS the
 * tenant's own admin being provisioned, not a cross-tenant platform read).
 * Idempotent: no-ops if SEED_ADMIN_EMAIL already has an account.
 *
 * Usage: SEED_TENANT_NAME=... SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... PASSWORD_PEPPER=... node dist/bootstrap/seed.js
 */
async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const pepper = process.env.PASSWORD_PEPPER;
  if (!adminEmail || !adminPassword || !pepper) {
    throw new Error('SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, and PASSWORD_PEPPER are required.');
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const tenants = app.get(TenantsRepository);
    const users = app.get(UsersRepository);
    const cls = app.get(ClsService);

    const existing = await users.findByEmailForAuth(adminEmail);
    if (existing) {
      console.log(`Seed: account ${adminEmail} already exists — nothing to do.`);
      return;
    }

    const tenant = await tenants.create({
      name: process.env.SEED_TENANT_NAME ?? 'Default Tenant',
      edition: 'kb',
      storageQuotaBytes: 1_073_741_824,
      featureToggles: [],
    });

    const passwordHash = await hashPassword(adminPassword, pepper);

    await cls.run(async () => {
      cls.set(SCOPE_CLS_KEY, {
        tenantId: tenant._id,
        userId: tenant._id, // placeholder — unused by ScopedRepository.create()'s buildFilter
        role: 'admin' as const,
        edition: tenant.edition,
      });
      await users.create({
        email: adminEmail,
        passwordHash,
        role: 'admin',
        status: 'active',
        mfaEnabled: false,
        totpBackupCodeHashes: [],
      });
    });

    console.log(`Seed complete: tenant "${tenant.name}" (${tenant._id}), admin ${adminEmail}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
