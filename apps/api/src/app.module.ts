import { Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ClsModule } from 'nestjs-cls';
import { Tenant, TenantSchema, User, UserSchema, TenantsRepository, UsersRepository } from '@kms/data';
import { HealthController } from './health/health.controller';
import { AuthController } from './auth/auth.controller';
import { TenantUsersAdminController } from './tenant-admin/tenant-users-admin.controller';
import { SessionAuthGuard } from './auth/session-auth.guard';
import {
  passwordPepperProvider,
  kmsKeyProviderProvider,
  rateLimiterProvider,
  captchaVerifierProvider,
  securityAlertSinkProvider,
} from './auth/auth.providers';
import { MfaGateGuard } from './common/mfa-gate.guard';
import { TosGateGuard } from './common/tos-gate.guard';
import { EditionGuard } from './common/edition.guard';
import { AdminOnlyGuard } from './common/admin-only.guard';
import { redisAppProvider, sessionServiceProvider } from './redis.provider';

@Module({
  imports: [
    DiscoveryModule,
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),
    MongooseModule.forRoot(process.env.MONGO_URI ?? 'mongodb://localhost:27017/kms'),
    MongooseModule.forFeature([
      { name: Tenant.name, schema: TenantSchema },
      { name: User.name, schema: UserSchema },
    ]),
    // Feature modules (folders, chat, ...) register here starting Phase 2.
  ],
  controllers: [HealthController, AuthController, TenantUsersAdminController],
  providers: [
    redisAppProvider,
    sessionServiceProvider,
    passwordPepperProvider,
    kmsKeyProviderProvider,
    rateLimiterProvider,
    captchaVerifierProvider,
    securityAlertSinkProvider,
    TenantsRepository,
    UsersRepository,
    AdminOnlyGuard,
    // Order matters: SessionAuthGuard populates the CLS scope (and the mfaVerified/
    // tosVersion flags); MfaGateGuard blocks the interim pre-TOTP session from
    // reaching anything but /auth/totp + logout; TosGateGuard routes a stale-ToS
    // user to re-acceptance; EditionGuard 404s a mismatched-edition route last.
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: MfaGateGuard },
    { provide: APP_GUARD, useClass: TosGateGuard },
    { provide: APP_GUARD, useClass: EditionGuard },
  ],
})
export class AppModule {}
