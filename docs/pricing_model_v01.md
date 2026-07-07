# Pricing Model Proposal — v01 (DRAFT)

Date: 2026-07-07 · Status: PROPOSAL — all prices are placeholders pending willingness-to-pay validation
Applies to: `requirements_v02.md` (§5 billing hooks, §9 metering, §15 Smart OCR edition)

## 1. Principles

1. **Price on value metrics customers understand.** Customers think in *seats*, *documents*, and *pages* — never in tokens. Tokens are metered internally (§9/§15) to protect margin, but are not a customer-facing unit.
2. **Predictable invoices for the Israeli B2B market.** Organizations here (certainly public-sector-adjacent ones) budget annually and dislike open-ended metered bills. Prefer subscriptions + prepaid packs over post-paid overage.
3. **Pricing is iterated, not set.** Revisit every 6 months; early tenants are grandfathered for 12 months on any price change.
4. **Smart OCR is the land-and-expand wedge.** Low-commitment usage pricing gets an org in the door; the Knowledge Base edition is the expansion.

## 2. Unit economics (cost floor, rough estimates — validate before launch)

| Cost driver | Estimate | Basis |
|---|---|---|
| Chat message (RAG) | ~₪0.13 (~$0.035) | ~8K input + ~700 output tokens, Sonnet-class API pricing |
| Embedding ingestion | Negligible | One-time per document version |
| Classic OCR page | ~₪0.006 | Google Vision ~$1.50/1,000 pages |
| Advanced OCR page | ~₪0.06–0.08 | ~1,500 in + ~800 out tokens/page, vision LLM |
| Infra baseline | ~₪250–300/tenant/mo | Atlas + Redis + hosting + email, amortized over 20 tenants |

## 3. Knowledge Base edition — subscription tiers

Per-tenant monthly subscription (annual billing, ILS, VAT excluded), sized by seat band with pooled AI allowances:

| | **Team** | **Organization** | **Enterprise** |
|---|---|---|---|
| Price / month | **₪1,800** | **₪4,500** | Custom |
| Users | up to 100 | up to 400 | custom |
| Storage | 1 GB | 3 GB | custom |
| Chat messages / month (pooled) | 3,000 | 10,000 | custom |
| OCR page-units / month (pooled) | 1,000 | 5,000 | custom |
| Support | Email | Priority | SLA + CSM |

* **Allowances are pooled per tenant**, not per seat — internal knowledge tools always have many passive users, so pure per-seat pricing punishes exactly the broad rollout we want.
* **Top-ups (prepaid packs, 12-month validity):** chat messages ₪250 / 1,000; storage ₪100 / GB / month; OCR pages per §4 rates.
* **When an allowance is exhausted:** graceful degradation per requirements §10 (chat pauses, search stays up) until top-up — no surprise overage invoices.
* **Margin check (Organization tier, worst case fully used):** chat ₪1,300 + OCR ₪30–300 + infra ₪300 ≈ ₪1,900 cost → ~58–60% gross margin floor. Typical usage will be far lower.

## 4. Smart OCR standalone edition — platform fee + prepaid page packs

**₪250/month platform fee** per organization (admin portal, user management, audit, unlimited users) plus prepaid page packs:

| Pack | Classic OCR | Advanced OCR (LLM) |
|---|---|---|
| Pay-as-you-go list | ₪0.15 / page | ₪0.90 / page |
| 1,000 pages | ₪120 (₪0.12) | ₪750 (₪0.75) |
| 10,000 pages | ₪900 (₪0.09) | ₪6,000 (₪0.60) |

* **Page-unit definition (margin guardrail):** 1 page-unit = one processed page up to 3,000 extracted tokens; an unusually dense page counts as multiple page-units. This keeps the customer unit simple while capping token exposure on Advanced OCR. Internal token metering (requirements §9/§15) verifies realized margin monthly.
* **Pack validity:** 12 months, shared across the organization's users; per-user monthly quotas (§9) remain an admin control, not a billing unit.
* **Margin:** Advanced ≈ 8–12× cost at pack rates; Classic ≈ 15–20×. Room to discount in deals.
* **Upgrade incentive:** 50% of the last 3 months' Smart OCR spend is credited toward the first Knowledge Base edition invoice.

## 5. Alternative considered: unified AI credits

One credit currency (1 chat message = 1 credit; Classic page = 1; Advanced page = 6) across both editions. Cleaner metering and future-proof for new AI features, but harder to communicate and price-anchor in early sales conversations. **Recommendation: start with the concrete model above; migrate to credits at v2 if the feature surface grows.**

## 6. What must be validated before these numbers are real

1. **WTP interviews** with 5–10 target organizations (per edition): "what would you pay today?" — before building any billing integration.
2. **Actual token consumption** per chat message and per Advanced OCR page on real Hebrew documents (the §2 estimates are the biggest uncertainty).
3. **Competitive anchors** in the Israeli market (document-management + OCR bureaus' per-page rates set customer expectations for §4).
4. **Currency & indexation:** ILS assumed; decide USD option and CPI/FX indexation clause for annual contracts.

## Open decisions for product owner

- [ ] Approve pricing structure (metrics & mechanics) separately from price points
- [ ] Pilot pricing for first 3–5 design partners (suggest: 50% off Year 1, grandfathered 12 months, in exchange for WTP/case-study access)
- [ ] Whether the ₪250 Smart OCR platform fee is waived above a monthly page-pack spend
