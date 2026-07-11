import { ClsService } from 'nestjs-cls';

const SYSTEM_FLAG_KEY = 'systemScope' as const;

export type SystemScopeAuditWriter = (event: {
  reason: string;
  module: string;
  at: Date;
}) => Promise<void>;

/**
 * Escape hatch for platform-admin operations and system jobs that legitimately
 * operate across tenants (ADR-0001). Sets a CLS flag the backstop plugin honors,
 * and writes an audit event with the reason. Import-restricted by lint to
 * platform-admin/** and jobs/** (see eslint-rules/no-restricted-imports config).
 */
export class SystemScope {
  static async run<T>(
    cls: ClsService,
    auditWrite: SystemScopeAuditWriter,
    reason: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return cls.run(async () => {
      cls.set(SYSTEM_FLAG_KEY, true);
      await auditWrite({ reason, module: callerModule(), at: new Date() });
      return fn();
    });
  }

  static isActive(cls: ClsService): boolean {
    return cls.get(SYSTEM_FLAG_KEY) === true;
  }
}

function callerModule(): string {
  // Best-effort caller identification for the audit event; refined when the
  // audit-event schema (ADR-0002) lands in Phase 1.
  const stack = new Error().stack ?? '';
  const line = stack.split('\n')[3] ?? 'unknown';
  return line.trim();
}
