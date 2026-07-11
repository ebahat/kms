import { Controller, Get } from '@nestjs/common';
import { Public } from '@kms/contracts';

/** Infra-only route — a load balancer health check carries no session cookie at all. */
@Controller('health')
@Public()
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
