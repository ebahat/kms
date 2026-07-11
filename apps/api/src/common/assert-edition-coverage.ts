import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DiscoveryService } from '@nestjs/core';
import { EDITION_EXEMPT_KEY, EDITION_METADATA_KEY } from '@kms/contracts';

/**
 * Bootstrap-time assertion (ADR-0009 consequences): a controller with
 * neither @Edition() nor @EditionExempt() fails startup rather than silently
 * serving un-gated in production. Run this from main.ts after app creation,
 * before listen().
 */
export async function assertEditionCoverage(app: INestApplication): Promise<void> {
  const discovery = app.get(DiscoveryService);
  const reflector = app.get(Reflector);
  const controllers = discovery.getControllers();

  const uncovered: string[] = [];
  for (const wrapper of controllers) {
    const instance = wrapper.instance;
    if (!instance) continue;
    const ctor = instance.constructor;
    const hasEdition = reflector.get(EDITION_METADATA_KEY, ctor) !== undefined;
    const isExempt = reflector.get(EDITION_EXEMPT_KEY, ctor) === true;
    if (!hasEdition && !isExempt) {
      uncovered.push(ctor.name);
    }
  }

  if (uncovered.length > 0) {
    throw new Error(
      `Edition-coverage assertion failed (ADR-0009 G2): controllers missing @Edition()/@EditionExempt(): ${uncovered.join(', ')}`,
    );
  }
}
