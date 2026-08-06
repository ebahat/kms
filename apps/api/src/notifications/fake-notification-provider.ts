import { Injectable } from '@nestjs/common';
import { NotificationProvider, SendEmailArgs } from './notification-provider';

/**
 * Dev/test binding — records sends in memory instead of calling out to
 * Resend. Used whenever RESEND_API_KEY isn't set (notifications.providers.ts),
 * mirroring FakeStorageProvider's role for StorageProvider.
 */
@Injectable()
export class FakeNotificationProvider implements NotificationProvider {
  readonly sent: SendEmailArgs[] = [];

  async sendEmail(args: SendEmailArgs): Promise<void> {
    this.sent.push(args);
  }
}
