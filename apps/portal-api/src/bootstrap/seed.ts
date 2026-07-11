import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { hashPassword } from '@kms/auth';
import { PlatformAdminsRepository } from '@kms/data';
import { AppModule } from '../app.module';

/**
 * One-time bootstrap: creates the first platform admin. Idempotent on email.
 * Usage: SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... PASSWORD_PEPPER=... node dist/bootstrap/seed.js
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
    const admins = app.get(PlatformAdminsRepository);

    const existing = await admins.findByEmail(adminEmail);
    if (existing) {
      console.log(`Seed: platform admin ${adminEmail} already exists — nothing to do.`);
      return;
    }

    const passwordHash = await hashPassword(adminPassword, pepper);
    const created = await admins.create({ email: adminEmail, passwordHash });
    console.log(`Seed complete: platform admin ${adminEmail} (${created._id}). Enroll TOTP on first login.`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
