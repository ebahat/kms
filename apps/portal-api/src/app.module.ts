import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ClsModule } from 'nestjs-cls';
import { Tenant, TenantSchema, PlatformAdmin, PlatformAdminSchema, User, UserSchema, TenantsRepository, PlatformAdminsRepository, UsersRepository } from '@kms/data';
import { HealthController } from './health/health.controller';
import { PlatformAuthController } from './auth/platform-auth.controller';
import { PlatformSessionAuthGuard } from './auth/platform-session-auth.guard';
import {
  passwordPepperProvider,
  kmsKeyProviderProvider,
  rateLimiterProvider,
  captchaVerifierProvider,
  securityAlertSinkProvider,
} from './auth/auth.providers';
import { PlatformMfaGateGuard } from './common/platform-mfa-gate.guard';
import { MfaResetController } from './platform-admin/mfa-reset.controller';
import { PlatformTenantsController } from './platform-admin/tenants.controller';
import { storageProviderProvider } from './platform-admin/tenant-storage.providers';
import { redisAppProvider, sessionServiceProvider } from './redis.provider';

@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),
    MongooseModule.forRoot(process.env.MONGO_URI ?? 'mongodb://localhost:27017/kms'),
    MongooseModule.forFeature([
      { name: Tenant.name, schema: TenantSchema },
      { name: PlatformAdmin.name, schema: PlatformAdminSchema },
      // Phase C, C1.2: provisioning a tenant's first admin needs UsersRepository here too — the
      // same collection apps/api owns, now also written from the platform-admin realm.
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [HealthController, PlatformAuthController, MfaResetController, PlatformTenantsController],
  providers: [
    redisAppProvider,
    sessionServiceProvider,
    passwordPepperProvider,
    kmsKeyProviderProvider,
    rateLimiterProvider,
    captchaVerifierProvider,
    securityAlertSinkProvider,
    storageProviderProvider,
    TenantsRepository,
    PlatformAdminsRepository,
    UsersRepository,
    // Order matters: PlatformSessionAuthGuard populates PlatformScope + mfaVerified;
    // PlatformMfaGateGuard blocks the interim pre-TOTP session from everything but /auth/totp+logout.
    { provide: APP_GUARD, useClass: PlatformSessionAuthGuard },
    { provide: APP_GUARD, useClass: PlatformMfaGateGuard },
  ],
})
export class AppModule {}
