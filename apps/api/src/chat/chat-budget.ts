import { RateLimiter } from '@kms/auth';
import { ChatBudgetExhaustedError, ChatRateLimitedError } from './chat-errors';

const RATE_LIMIT_WINDOW_SECONDS = 60 * 60; // 1 hour
const DEFAULT_RATE_LIMIT_PER_HOUR = 30; // PRD §10
const MONTHLY_BUDGET_TTL_SECONDS = 31 * 24 * 60 * 60;
const DEFAULT_TENANT_MONTHLY_MESSAGE_BUDGET = 2000;

/**
 * PRD §10 / sec §5.5 cost controls, checked before any streaming starts. The
 * tenant budget is message-count-based, not token-precise — no per-message
 * token-usage plumbing exists yet in this pass (a deliberate simplification,
 * see the plan's scope cuts); both limits are env-configured, not
 * admin-UI-configurable (also a scope cut — the check/response exist, the
 * config screen doesn't). Reuses `libs/auth`'s existing `RateLimiter`
 * (redis-app, ADR-0007) under new `chat:*` key prefixes, same primitive
 * TOTP/login-hardening already use — not a second rate-limiting mechanism.
 */
export async function enforceChatLimits(rateLimiter: RateLimiter, tenantId: string, userId: string): Promise<void> {
  const perUserLimit = Number(process.env.CHAT_RATE_LIMIT_PER_HOUR ?? DEFAULT_RATE_LIMIT_PER_HOUR);
  const userCount = await rateLimiter.increment(`chat:msg:${userId}`, RATE_LIMIT_WINDOW_SECONDS);
  if (userCount > perUserLimit) throw new ChatRateLimitedError(RATE_LIMIT_WINDOW_SECONDS);

  const monthlyBudget = Number(process.env.CHAT_TENANT_MONTHLY_MESSAGE_BUDGET ?? DEFAULT_TENANT_MONTHLY_MESSAGE_BUDGET);
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  const tenantCount = await rateLimiter.increment(`chat:tenant-budget:${tenantId}:${period}`, MONTHLY_BUDGET_TTL_SECONDS);
  if (tenantCount > monthlyBudget) throw new ChatBudgetExhaustedError();
}
