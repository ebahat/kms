import { Controller, Get } from '@nestjs/common';
import { EditionExempt } from '@kms/contracts';

/**
 * Infra-only route, exempt from @Edition (ADR-0009 G2) — it carries no
 * tenant data and must respond identically regardless of edition.
 */
@Controller('health')
@EditionExempt()
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
