import { Provider } from '@nestjs/common';
import { FakeNotificationProvider } from './fake-notification-provider';
import { ResendNotificationProvider } from './resend-notification-provider';
import { NotificationProvider } from './notification-provider';

export const NOTIFICATION_PROVIDER = 'NOTIFICATION_PROVIDER' as const;

/**
 * ResendNotificationProvider needs a live RESEND_API_KEY (ADR-0013), which
 * doesn't exist in this environment. Falls back to the in-memory
 * FakeNotificationProvider whenever it's unset, so local dev and tests keep
 * working — mirrors documents.providers.ts's storageProviderProvider pattern.
 */
export const notificationProviderProvider: Provider = {
  provide: NOTIFICATION_PROVIDER,
  useFactory: (): NotificationProvider => {
    const apiKey = process.env.RESEND_API_KEY;
    const fromAddress = process.env.NOTIFICATION_FROM_ADDRESS ?? 'noreply@example.com';
    return apiKey ? new ResendNotificationProvider(apiKey, fromAddress) : new FakeNotificationProvider();
  },
};

export type { NotificationProvider };
