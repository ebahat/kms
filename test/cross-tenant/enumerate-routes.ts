import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export type EnumeratedRoute = {
  method: string;
  path: string;
  edition: 'kb' | 'ocr' | 'both' | undefined;
};

/**
 * Walks the live NestJS route table so the cross-tenant suite cannot go
 * stale (ADR-0001 CI guard 3: "new routes are auto-enumerated from the
 * route table"). Populated against a real bootstrapped app starting Phase 1.
 */
export function enumerateRoutes(app: INestApplication): EnumeratedRoute[] {
  const server = app.getHttpAdapter().getInstance();
  const router = server._router;
  if (!router?.stack) return [];

  const routes: EnumeratedRoute[] = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const path: string = layer.route.path;
    const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
    for (const method of methods) {
      routes.push({ method: method.toUpperCase(), path, edition: undefined });
    }
  }
  return routes;
}
