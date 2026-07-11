import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),
    // Platform-admin feature modules (tenants, users, audit views) register
    // here starting Phase 1 (ADR-0004). All cross-tenant reads run under
    // SystemScope.run — see libs/data.
  ],
  controllers: [HealthController],
})
export class AppModule {}
