import { ResendNotificationProvider } from './resend-notification-provider';

describe('ResendNotificationProvider', () => {
  const args = { to: 'user@example.com', subject: 'Hi', body: '<p>hi</p>' };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts to the Resend API with the expected payload', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const provider = new ResendNotificationProvider('re_test_key', 'noreply@example.com');

    await provider.sendEmail(args);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer re_test_key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          from: 'noreply@example.com',
          to: args.to,
          subject: args.subject,
          html: args.body,
        }),
      }),
    );
  });

  it('does not throw on a non-ok response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: () => Promise.resolve('bad request') });
    const provider = new ResendNotificationProvider('re_test_key', 'noreply@example.com');

    await expect(provider.sendEmail(args)).resolves.toBeUndefined();
  });

  it('does not throw when fetch itself rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const provider = new ResendNotificationProvider('re_test_key', 'noreply@example.com');

    await expect(provider.sendEmail(args)).resolves.toBeUndefined();
  });
});
