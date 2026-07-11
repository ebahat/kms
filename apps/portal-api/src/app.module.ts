import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ClsModule } from 'nestjs-cls';
import { Tenant, TenantSchema, PlatformAdmin, PlatformAdminSchema, TenantsRepository, PlatformAdminsRepository } from '@kms/data';
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
    TenantsRepository,
    PlatformAdminsRepository,
    // Order matters: PlatformSessionAuthGuard populates PlatformScope + mfaVerified;
    // PlatformMfaGateGuard blocks the interim pre-TOTP session from everything but /auth/totp+logout.
    { provide: APP_GUARD, useClass: PlatformSessionAuthGuard },
    { provide: APP_GUARD, useClass: PlatformMfaGateGuard },
  ],
})
export class AppModule {}
