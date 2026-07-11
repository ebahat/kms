import { Logger } from '@nestjs/common';

export interface SecurityAlertSink {
  failedLoginBurst(email: string, count: number): void;
  lockoutTriggered(email: string): void;
}

/** Logs for now (sec §8.3) — swap for a real alerting integration (PagerDuty/Slack) once one is chosen. Shared by both realms (ADR-0004). */
export class LoggingSecurityAlertSink implements SecurityAlertSink {
  private readonly logger = new Logger('SecurityAlerts');

  failedLoginBurst(email: string, count: number): void {
    this.logger.warn(`failed-login burst: ${email} (${count} failures)`);
  }

  lockoutTriggered(email: string): void {
    this.logger.warn(`lockout triggered: ${email}`);
  }
}
