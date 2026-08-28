/** Thrown before any streaming starts — the exception filter maps this to 429 with a machine-readable retry hint (PRD §10: 30 msg/h default). */
export class ChatRateLimitedError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('chat rate limit exceeded');
  }
}

/** Thrown before any streaming starts — sec §5.5 denial-of-wallet control. The message-count-based budget (not token-precise — no token-usage plumbing exists yet, a deliberate simplification, see the plan's scope cuts) is env-configured, not admin-UI-configurable this pass. */
export class ChatBudgetExhaustedError extends Error {
  constructor() {
    super('tenant chat budget exhausted for this period');
  }
}
