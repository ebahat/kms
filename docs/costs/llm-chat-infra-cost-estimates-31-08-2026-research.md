# LLM Chat & Infrastructure Cost Estimates — Research Notes

Date: 2026-08-31 · Status: research/estimates, not a finalized pricing decision
Related: `docs/pricing_model_v01.md` (customer-facing pricing proposal), ADR-0008 (LLM/embedding provider choice), ADR-0002 (Atlas data/index design), ADR-0015 (OCI hosting topology)

Everything below is either (a) fetched live from provider pricing pages on 2026-08-30/31 (cited), or (b) measured directly against this project's own live infrastructure (the `$vectorSearch` test, the real chunk-density measurement) — not carried forward from the older estimates in `docs/pricing_model_v01.md`, which predate a real Claude price drop and never accounted for the actual OCI Always-Free topology this project now runs on.

## 1. Key takeaways

1. **Chat tokens are the only cost driver that scales with usage in any of the scenarios modeled below.** Storage, network egress, and Atlas are all $0 at every volume tested, given the current OCI Always-Free + Atlas M0 architecture (ADR-0015).
2. **`docs/pricing_model_v01.md`'s ₪0.13/chat-message estimate is stale on two counts**: it uses Sonnet-class pricing as a stand-in when ADR-0008's actual *primary* provider is Gemini **Flash**-tier (Sonnet is the named fallback only), and Claude's own price dropped since that doc was written (Sonnet 5 is now $2/$10 per MTok, confirmed permanent — not the $3/$15 assumed).
3. **Atlas Vector Search on the free M0 tier is now confirmed working** — live-tested 2026-08-31 (§7). This was the single largest unresolved cost risk (a forced M10 upgrade would have been ~$170/mo for a real 3-node replica set) and it's resolved: $0.
4. **No live LLM provider credentials exist yet** — all estimates below are hypothetical until a real Vertex/Claude account is funded and wired in.
5. **The 8K-input-token-per-message assumption (from the original pricing doc) is unverified** against real Hebrew usage — it's literally what the ADR-0008 Hebrew benchmark gate (Lane E1, not yet run) exists to measure. Treat every number below as directional, not final.

## 2. Real provider pricing (fetched live, 2026-08-30)

### Chat generation, per 1M tokens (USD)

| Model | Role (per ADR-0008) | Input | Output |
|---|---|---|---|
| Gemini 2.5 Flash-Lite | cheapest current Flash-tier | $0.10 | $0.40 |
| Gemini 2.5 Flash | mid Flash-tier | $0.30 | $2.50 |
| Gemini 3.6/3.7 Flash | newest Flash-tier, 2026 intro pricing (→ Dec 31 2026; $1.50/$7.50 standard from 2027) | $0.75 | $3.75 |
| Claude Sonnet 5 | **named fallback**, used only if the Hebrew faithfulness gate fails on Flash | $2.00 | $10.00 |

Source: [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing)

### OCR, per unit

| Service | Rate |
|---|---|
| Classic OCR (Google Cloud Vision API) | $1.50 / 1,000 pages (after 1,000 free/mo) — confirms `docs/pricing_model_v01.md`'s existing ₪0.006/page estimate |
| Advanced OCR (Gemini vision, same rate card as chat) | ~1,500 in + ~800 out tokens/page (pricing doc's own estimate) → Flash-Lite ≈ **$0.0005/page**, standard Flash ≈ **$0.0025/page (~$2.50/1,000 pages)** — materially cheaper than the pricing doc's original "10x Classic" assumption, which used Sonnet-class rates |

Source: [Cloud Vision API pricing](https://cloud.google.com/vision/pricing)

### Embedding, per 1M tokens

Gemini embedding models: $0.15–0.20/MTok. Negligible at any realistic ingestion volume (e.g. ~2M tokens across 1,000 documents ≈ under $0.50, one-time).

### Eval/benchmark-gate judge cost (one-time)

ADR-0008 requires a judge model from a *different family than generation* (Claude judging Gemini) for the Hebrew benchmark gate. At ~540+ QA pairs across `heb-qa`/`heb-prefix`/`exact-term`/`mixed-lang`, judged with Claude Sonnet 5: **~$2–5 total, one-time** (repeats only on a model swap). Not a real budget line.

## 3. Per-message chat cost formula

Using the pricing doc's own token assumption (~8K input + ~700 output per message — **unverified**, see §1.5):

```
cost_per_message = (8000/1e6 × input_rate) + (700/1e6 × output_rate)
```

| Model | Cost/message |
|---|---|
| Gemini 2.5 Flash-Lite | $0.0011 |
| Gemini 2.5 Flash | $0.0042 |
| Gemini 3.6/3.7 Flash (2026 intro) | $0.0086 |
| Claude Sonnet 5 (fallback) | $0.0230 |

## 4. Worked scenarios

FX used throughout: ₪3.65/$1 (approximate — verify live rate before quoting a customer).

### Scenario A — 10 users, 1,000 docs × 5MB avg, 20 chats/user/day, 10 downloads/user/day

- Storage: 1,000 × 5MB = 4.9GB → inside 20GB OCI Always-Free ceiling → **$0**
- Egress: 10/user/day × 10 × 30 days × 5MB ≈ 14.6GB/mo → inside 10TB Always-Free ceiling → **$0**
- Chat: 20/user/day × 10 × 30 = 6,000 msgs/mo

| Model | Monthly chat cost |
|---|---|
| Flash-Lite | ~$6.5 (~₪24) |
| Flash | ~$25 (~₪91) |
| Flash (2026 intro) | ~$52 (~₪189) |
| Sonnet 5 fallback | ~$138 (~₪504) |

### Scenario B — 10 users, 300 docs × 5MB avg, 40 chats/user/day, 20 downloads/user/day, no OCR

- Storage: 300 × 5MB = 1.5GB → **$0**
- Egress: 20/user/day × 10 × 30 × 5MB ≈ 29GB/mo → **$0**
- Atlas chunks collection: real measurement (§8) gives ~9.7 chunks/MB of source file on text-dense real documents → extrapolated ~17,700 chunks for 300 × 5MB docs ≈ ~160MB, comfortably under M0's 512MB cap — **but not verified against real 5MB documents**, only extrapolated from ~170KB real samples; scanned/image-heavy 5MB docs would likely produce *fewer* chunks, not more.
- OCR: none → **$0**
- Chat: 40/user/day × 10 × 30 = 12,000 msgs/mo

| Model | Monthly chat cost |
|---|---|
| Flash-Lite | ~$13 (~₪47) |
| Flash | ~$50 (~₪182) |
| Flash (2026 intro) | ~$103 (~₪377) |
| Sonnet 5 fallback | ~$276 (~₪1,007) |

## 5. OCI infra cost if outside Always Free (live pricing, 2026-08-31)

For Scenario B's volumes, at standard (non-Always-Free) OCI rates:

| Line item | Rate | This scenario | Cost |
|---|---|---|---|
| Compute (2 OCPU/12GB VM, 24/7, 730 hrs/mo) | $0.01/OCPU-hr + $0.0015/GB-hr | — | **~$27.74/mo** |
| Object Storage (1.5GB) | $0.0255/GB/mo | 1.5GB | **~$0.04/mo** |
| Egress (29GB/mo) | $0.0085/GB beyond 10TB/mo | 29GB | **$0** — the 10TB/mo free allowance is **tenancy-wide**, not Always-Free-specific; it applies at any OCI account tier |

**Total OCI infra outside Always Free: ~$27.78/mo ≈ ₪101/mo.** Redis is self-hosted on the same VM (ADR-0015), so no separate managed-cache line. Atlas M0 is MongoDB's own free tier, separate from OCI, and stays $0 regardless of OCI tier status.

Source: [Ampere A1 Compute pricing](https://www.oracle.com/cloud/compute/arm/), [OCI Object Storage/egress pricing](https://www.oracle.com/cloud/price-list/)

### Combined total, Scenario B, outside OCI Always Free

| Chat tier | OCI infra | Chat | **Total** |
|---|---|---|---|
| Flash-Lite | ₪101 | ₪47 | **~₪148/mo** |
| Flash | ₪101 | ₪182 | **~₪283/mo** |
| Flash (2026 intro) | ₪101 | ₪377 | **~₪478/mo** |
| Sonnet 5 fallback | ₪101 | ₪1,007 | **~₪1,108/mo** |

## 6. Non-token, non-recurring items

- **GCP/Vertex account setup**: no flat platform fee, pure usage-based — but requires a real GCP project with a linked billing account (funded payment method) before any API call works. Same for a funded Anthropic account. Process gates, not $ costs.
- **4 LLM-provider-key Vault secrets are still placeholders** in production (`infra/` — tracked separately, not a cost item, a blocker to turning any of the above on for real).

## 7. Atlas Vector Search M0 capability — live-verified, 2026-08-31

Full record in ADR-0002 ("`$vectorSearch` capability verified live on Atlas M0"). Summary: real disposable-collection test against the production cluster (`cluster0.bnezwpz.mongodb.net`) — created a real `vectorSearch` index via `createSearchIndex()`, it went `PENDING` → `queryable: true` in ~29 seconds, a real `$vectorSearch` aggregation returned correctly cosine-ranked results, index and collection dropped immediately after (no tenant data touched). **Confirmed: no M10 upgrade needed for vector search capability.** This does not touch Hebrew retrieval *quality* — that stays gated on ADR-0008's unrun benchmark corpus (Lane E1).

## 8. Real chunk-density measurement, 2026-08-31

Ran the actual `libs/parsing` `parsePdf` + `chunkPages` functions (not a guess) against 8 real documents from `test-datasets/` (real Hebrew board/committee protocol PDFs, 170–200KB, 1–3 pages each):

- **~9.7 chunks per MB of source file size**
- Average chunk ≈1,430 extracted characters
- Atlas storage per chunk ≈ **~9KB**, dominated by the 768-dim embedding vector (~6KB as BSON doubles), not the text (~2.8KB as Hebrew UTF-8)

This is far sparser than ADR-0002's own planning-stage "~100 chunks/doc" assumption (which was sized for the 10x-scale case, ~40k docs). **Caveat: these real samples (~170KB) are ~25–30x smaller than the "5MB average" planning figure used in Scenario B** — the extrapolation in §4 assumes similar text density scaled linearly; real 5MB documents that are scanned/image-heavy would produce fewer chunks (and less Atlas storage), not more, since image bytes don't add extractable text. Verify against real 5MB-class documents before treating the Scenario B Atlas estimate as final.

## 9. Open items / what's still unverified

- Real Hebrew token-per-message consumption (input tokens especially) — blocks finalizing which chat-tier line in every table above is the real one.
- Hebrew retrieval *quality* on Vertex embeddings (ADR-0008's benchmark gate, Lane E1 corpus — not yet authored).
- Real GCP/Vertex and Anthropic billing accounts are not yet funded/wired in.
- Atlas chunk storage for genuinely 5MB-average documents — only extrapolated, not measured.
