import { Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { HealthController } from './health/health.controller';
import { SessionAuthGuard } from './auth/session-auth.guard';
import { EditionGuard } from './common/edition.guard';
import { redisAppProvider, sessionServiceProvider } from './redis.provider';

@Module({
  imports: [
    DiscoveryModule,
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),
    // Feature modules (folders, chat, ...) register here starting Phase 2.
  ],
  controllers: [HealthController],
  providers: [
    redisAppProvider,
    sessionServiceProvider,
    // Order matters: SessionAuthGuard populates the CLS scope; EditionGuard reads it.
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: EditionGuard },
  ],
})
export class AppModule {}
