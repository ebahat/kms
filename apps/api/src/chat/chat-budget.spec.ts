import { enforceChatLimits } from './chat-budget';
import { ChatBudgetExhaustedError, ChatRateLimitedError } from './chat-errors';

describe('enforceChatLimits', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('passes when both counters are under their limits', async () => {
    process.env.CHAT_RATE_LIMIT_PER_HOUR = '30';
    process.env.CHAT_TENANT_MONTHLY_MESSAGE_BUDGET = '2000';
    const rateLimiter = { increment: jest.fn().mockResolvedValue(1) } as any;

    await expect(enforceChatLimits(rateLimiter, 'tenant1', 'user1')).resolves.toBeUndefined();
  });

  it('throws ChatRateLimitedError once the per-user hourly count exceeds the configured limit', async () => {
    process.env.CHAT_RATE_LIMIT_PER_HOUR = '30';
    const rateLimiter = { increment: jest.fn().mockResolvedValueOnce(31) } as any;

    await expect(enforceChatLimits(rateLimiter, 'tenant1', 'user1')).rejects.toThrow(ChatRateLimitedError);
  });

  it('checks the per-user limit under the chat:msg:{userId} key', async () => {
    const rateLimiter = { increment: jest.fn().mockResolvedValue(1) } as any;

    await enforceChatLimits(rateLimiter, 'tenant1', 'user1');

    expect(rateLimiter.increment).toHaveBeenCalledWith('chat:msg:user1', 3600);
  });

  it('throws ChatBudgetExhaustedError once the tenant monthly count exceeds the configured budget, even when the per-user count is fine', async () => {
    process.env.CHAT_RATE_LIMIT_PER_HOUR = '30';
    process.env.CHAT_TENANT_MONTHLY_MESSAGE_BUDGET = '2000';
    const rateLimiter = { increment: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2001) } as any;

    await expect(enforceChatLimits(rateLimiter, 'tenant1', 'user1')).rejects.toThrow(ChatBudgetExhaustedError);
  });

  it('checks the tenant budget under a chat:tenant-budget:{tenantId}:{YYYY-MM} key', async () => {
    const rateLimiter = { increment: jest.fn().mockResolvedValue(1) } as any;
    const period = new Date().toISOString().slice(0, 7);

    await enforceChatLimits(rateLimiter, 'tenant1', 'user1');

    expect(rateLimiter.increment).toHaveBeenCalledWith(`chat:tenant-budget:tenant1:${period}`, 31 * 24 * 60 * 60);
  });

  it('checks the per-user limit before the tenant budget — a rate-limited user never consumes tenant budget', async () => {
    process.env.CHAT_RATE_LIMIT_PER_HOUR = '30';
    const rateLimiter = { increment: jest.fn().mockResolvedValueOnce(31) } as any;

    await expect(enforceChatLimits(rateLimiter, 'tenant1', 'user1')).rejects.toThrow(ChatRateLimitedError);
    expect(rateLimiter.increment).toHaveBeenCalledTimes(1);
  });
});
