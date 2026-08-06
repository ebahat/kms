import { Injectable, Logger } from '@nestjs/common';
import { NotificationProvider, SendEmailArgs } from './notification-provider';

/**
 * Production binding for Resend (ADR-0013): single POST /emails call,
 * Bearer-token auth. Fire-and-forget per the design doc — failures are
 * logged, not thrown, and there is no retry queue for MVP (a BullMQ
 * escalation path is documented as a deferred future enhancement).
 */
@Injectable()
export class ResendNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger(ResendNotificationProvider.name);

  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
  ) {}

  async sendEmail(args: SendEmailArgs): Promise<void> {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.fromAddress, to: args.to, subject: args.subject, html: args.body }),
      });
      if (!res.ok) {
        this.logger.error(`send failed (${res.status}): ${await res.text()}`);
      }
    } catch (err) {
      this.logger.error(`send threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
