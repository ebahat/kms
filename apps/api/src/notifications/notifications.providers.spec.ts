import { FakeNotificationProvider } from './fake-notification-provider';
import { ResendNotificationProvider } from './resend-notification-provider';
import { notificationProviderProvider } from './notifications.providers';

describe('notificationProviderProvider', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('resolves to FakeNotificationProvider when RESEND_API_KEY is unset', () => {
    delete process.env.RESEND_API_KEY;
    const useFactory = (notificationProviderProvider as any).useFactory;

    const provider = useFactory();

    expect(provider).toBeInstanceOf(FakeNotificationProvider);
  });

  it('resolves to ResendNotificationProvider when RESEND_API_KEY is set', () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const useFactory = (notificationProviderProvider as any).useFactory;

    const provider = useFactory();

    expect(provider).toBeInstanceOf(ResendNotificationProvider);
  });
});
