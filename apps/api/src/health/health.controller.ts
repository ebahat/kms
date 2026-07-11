import { Controller, Get } from '@nestjs/common';
import { EditionExempt, TosExempt, Public } from '@kms/contracts';

/**
 * Infra-only route, exempt from @Edition (ADR-0009 G2) — it carries no
 * tenant data and must respond identically regardless of edition. Also
 * ToS-exempt (infra checks aren't a tenant user accepting terms) and
 * @Public() — a load balancer health check carries no session cookie at all.
 */
@Controller('health')
@EditionExempt()
@TosExempt()
@Public()
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
