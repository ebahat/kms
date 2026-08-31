# Anthropic (Claude) vs OpenAI (GPT-5 family) cost comparison — research notes

Date: 2026-08-31 · Status: research/estimates, not a provider decision
Related: `docs/costs/llm-chat-infra-cost-estimates-31-08-2026-research.md` (the fuller cost-research
doc this pass builds on — same per-message formula and scenario volumes), ADR-0008 (LLM/embedding
provider choice — currently names Vertex/Gemini primary, Claude Sonnet 5 the sole named fallback;
OpenAI is not currently a covered provider in that ADR).

## Pricing tables (fetched live, 2026-08-31)

### Anthropic (Claude), USD per 1M tokens

| Model | Input | Output | Cache write (5m) | Cache hit |
|---|---|---|---|---|
| Claude Opus 5 | 5.00 | 25.00 | 6.25 | 0.50 |
| Claude Sonnet 5 | 2.00 | 10.00 | 2.50 | 0.20 |
| Claude Haiku 4.5 | 1.00 | 5.00 | 1.25 | 0.10 |

Source: [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing)

### OpenAI (GPT-5 family), USD per 1M tokens

| Model | Input | Cached input | Output |
|---|---|---|---|
| GPT-5.6-sol (flagship) | 4.00 | 0.40 | 20.00 |
| GPT-5.6-terra | 2.00 | 0.20 | 12.00 |
| GPT-5.6-luna | 0.20 | 0.02 | 1.20 |
| GPT-5 / GPT-5.1 | 1.25 | 0.125 | 10.00 |
| GPT-5-mini | 0.25 | 0.025 | 2.00 |
| GPT-5-nano | 0.05 | 0.005 | 0.40 |

Source: [developers.openai.com/api/docs/pricing](https://developers.openai.com/api/docs/pricing)
(`platform.openai.com/docs/pricing` now redirects here)

## Per-message cost (this project's 8K-input/700-output assumption)

| Model | $/message | @6,000 msg/mo | @12,000 msg/mo |
|---|---|---|---|
| Claude Opus 5 | 0.0575 | $345 | $690 |
| **Claude Sonnet 5** (current ADR-0008 fallback) | **0.0230** | **$138** | **$276** |
| Claude Haiku 4.5 | 0.0115 | $69 | $138 |
| GPT-5.6-sol | 0.0460 | $276 | $552 |
| **GPT-5.6-terra** (closest tier match to Sonnet 5) | **0.0244** | **$146** | **$293** |
| GPT-5 / GPT-5.1 | 0.0170 | $102 | $204 |
| **GPT-5-mini** | **0.0034** | **$20** | **$41** |
| GPT-5-nano | 0.0007 | $4 | $8 |
| Gemini 2.5 Flash (this project's current primary, reference) | 0.0042 | $25 | $50 |

## Key findings

1. **Tier-for-tier, Claude and OpenAI are close.** Claude Sonnet 5 vs GPT-5.6-terra (same $2/MTok
   input): Claude is ~6% cheaper per message ($0.0230 vs $0.0244) thanks to a lower output rate
   ($10 vs $12/MTok). At flagship tier it flips — GPT-5.6-sol is ~20% cheaper than Claude Opus 5.
2. **Prompt-caching structure is identical across both providers**: cached/hit input tokens cost
   exactly 10% of base input price on every tier checked, for both Anthropic and OpenAI.
3. **GPT-5-mini is far cheaper than any Claude tier** — about 6-7x cheaper than Claude Haiku 4.5
   (the cheapest Claude tier), and ~14x cheaper than Sonnet 5 — but this is not a like-for-like
   comparison; GPT-5-mini is a smaller/cheaper capability class, not a similarly-positioned model.
4. **GPT-5-mini is cheaper than this project's current primary (Gemini 2.5 Flash)** too — about
   19% cheaper per message ($0.0034 vs $0.0042).

## Sources
- [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
