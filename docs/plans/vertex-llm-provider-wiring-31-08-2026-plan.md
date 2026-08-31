# Wiring real Vertex AI (Gemini 2.5 Flash) credentials for chat — 31-08-2026

## Context

The full RAG chat feature (Phase 3 ingestion + Phase 4 chat) was built and merged 2026-08-28
(`docs/plans/document-chat-rag-28-08-2026-plan.md`), but ran entirely on Fake providers — no real
LLM credentials existed, and (discovered during this pass) the feature had **never actually been
deployed**: `deploy/docker-compose.yml` had no worker services at all, and its own README still said
their absence was "the design, not an omission" (true before 2026-08-28, stale after).

User asked to wire real provider credentials, chose Gemini 2.5 Flash (Vertex AI) as the model.

## What was done

1. **[DONE]** GCP project audit — found a pre-existing, partially-set-up `kibo-kms` project
   (created 2026-08-30, one day prior) with Vertex AI enabled and a service account
   (`kibo-vertex@kibo-kms.iam.gserviceaccount.com`) but no IAM role and no billing linked. User
   confirmed this was their own prior setup, not a stray/unauthorized action. A duplicate empty
   project `kibo-kms-507108` was left untouched (not asked to clean up).
2. **[DONE]** Billing linked to `kibo-kms` — required unlinking `transcribe-zoom-438719` from the
   billing account first (self-service 5-project quota), which the user did themselves.
3. **[DONE]** `roles/aiplatform.user` granted to the service account; the two pre-existing keys
   were confirmed to be Google-internal `SYSTEM_MANAGED` keys (not a real exported/leaked
   credential — nothing to rotate there). One real `USER_MANAGED` key generated.
4. **[DONE]** Live-verified end to end: real access token → real `generateContent` call against
   `gemini-2.5-flash` → real HTTP 200 → real model response. Confirmed via both an explicit-keyFile
   probe and the exact ADC-env-var-only code path `VertexChatProvider`/`VertexEmbeddingProvider`
   actually use.
5. **[DONE]** Confirmed no fixed/idle costs: no Compute Engine, Cloud SQL, GKE, App Engine, or
   Storage buckets exist in `kibo-kms`; no Vertex AI Provisioned Throughput (the one Vertex offering
   with a fixed hourly cost) was set up. Only on-demand, pay-per-token `generateContent` calls —
   matches `docs/costs/llm-chat-infra-cost-estimates-31-08-2026-research.md`'s existing rate table.
6. **[DONE]** `VertexChatProvider.modelName` pinned from `gemini-flash-latest` to `gemini-2.5-flash`
   (`libs/ai-providers/src/vertex-chat-provider.ts`) — the user's explicit choice, now the literal
   verified string.
7. **[DONE]** Real bug found and fixed: `apps/worker/Dockerfile` used `WORKDIR /app` and copied the
   root `node_modules` to a wrongly-named `./root_node_modules` — pnpm's workspace symlinks (which
   encode relative paths back to the original `/repo` depth) could never resolve, and `libs/` wasn't
   copied at all. **Confirmed by actually building and running the old image**:
   `Error: Cannot find module 'reflect-metadata'` on boot — this would have crash-looped forever if
   deployed as-is; the worker had never been built+run before this pass. Fixed to mirror
   `apps/api/Dockerfile`'s correct pattern (preserve `/repo/apps/worker` depth, copy `/repo/node_modules`
   and `/repo/libs` to their original paths). Re-verified: the fixed image gets past module
   resolution into real NestJS bootstrap (only fails on a deliberately-incomplete test env var set).
8. **[DONE]** `deploy/docker-compose.yml`: added `VERTEX_PROJECT_ID`/`VERTEX_REGION`/
   `GOOGLE_APPLICATION_CREDENTIALS` + a read-only key-file mount to `api`; added three new services
   — `worker-parse`/`worker-ai`/`worker-index` (one image, three `WORKER_POOL` values, per
   ADR-0003/0009's original "one image, three deployments" design — first real deployment of it,
   previously only a Cloud Run split that was never applied). `REDIS_QUEUE_HOST` was already wired
   on `api` (2026-08-28) — a real BullMQ producer has been the default there for a while, it just
   had no consumer running until now.
9. **[DONE]** `deploy/.env.example`, `deploy/README.md` (new "Vertex AI credentials" section,
   corrected "what is NOT deployed" section — only `clamd` remains intentionally absent),
   `deploy/smoke-deploy.sh` (now also builds+pushes the worker image) all updated.
10. **[DONE]** OCI Vault secret `kms-kms-provider-vertex` rotated with the real service-account key
    content, out-of-band via `oci vault secret update-base64` (matching the existing
    "never through Terraform" pattern — `ignore_changes` on `secret_content`). Verified by
    decoding the live secret bundle and checking `private_key_id`/`client_email`/`project_id`
    match the real key, not just checking the version number incremented.
11. **[NOT DONE, explicit user decision]** Actual production deploy (copying `vertex-key.json` +
    updated `docker-compose.yml`/`.env` to the VM, `docker compose pull && up -d`) — blocked by
    Claude Code's own auto-mode classifier refusing direct SSH to the production host even with
    prior blanket approval. User chose to stop here rather than route around that safety rail;
    the config is deploy-ready but not deployed.

## Explicitly not done this pass (real gaps, not silently folded in)

- **Claude/Anthropic fallback** — not wired. User chose Gemini 2.5 Flash only; `ANTHROPIC_API_KEY`
  stays unset, so `chatProviderProvider` never reaches that branch.
- **Real Atlas Vector Search at query time** — `ATLAS_VECTOR_SEARCH` env var left unset, so
  `FakeRetrievalProvider` (brute-force cosine over stored embeddings, functionally correct on real
  data, just not using Atlas's ANN index) is still what's selected. `$vectorSearch` itself was
  live-verified as working on the M0 tier (ADR-0002, 2026-08-31) but no real `chunks_vector` Atlas
  Search index has been created on the production cluster, and `AtlasRetrievalProvider` has not
  been selected in any deployed config.
- **`featureToggles.llm`** — not enabled for any tenant yet. Chat stays unreachable (`ModuleGuard`
  404s it) until a platform admin turns it on for a specific tenant via `portal-api`.
- **ADR-0008 Hebrew benchmark gate** — still not run (pre-existing gap, Lane E1 corpus not authored,
  unrelated to this pass).
- **RESEND_API_KEY** — still a placeholder (pre-existing gap, found 2026-08-30, unrelated to LLM
  wiring, not touched here).
- **clamd / real malware scanning** — still `FakePassThroughScanProvider`, unstarted separate work.

## Verification

- `pnpm --filter @kms/ai-providers test:unit` — 13/13 passed (no test hardcoded the old model name).
- `pnpm --filter @kms/worker test:unit` — 15/15 passed (processor logic untouched by the Dockerfile fix).
- `docker compose config -q` — new compose file's syntax validated.
- Live Vertex AI round trip — real token, real `generateContent` call, real 200, real reply.
- Worker Dockerfile — built and ran both the old (broken, confirmed) and fixed (confirmed working
  past module resolution) images directly, not just read the diff.
- Vault secret rotation — confirmed via decoded bundle content matching the real key's
  `private_key_id`/`client_email`/`project_id`, not just the version-number field.

## Amendment: OpenAI gpt-5-mini replaces Claude as chat fallback (2026-08-31)

User requested a cost comparison (Anthropic vs OpenAI), then asked to proceed with GPT-5-mini —
after clarifying its role (initially considered "replace Gemini as primary," corrected to "replace
Claude as the fallback"). Full cost research saved to
`docs/costs/anthropic-vs-openai-cost-comparison-31-08-2026-research.md`.

1. **[DONE]** Live-verified the user's real OpenAI key against `gpt-5-mini`'s real API — found and
   fixed a real cost risk in the process: `gpt-5-mini` is a reasoning model that burns invisible
   "reasoning tokens" billed as output (a 1-word reply cost 64 reasoning tokens/75 total at default
   effort). `reasoning_effort: 'minimal'` brings this to 0, live-confirmed, and is baked into the
   provider — without it, real cost and streaming latency would both exceed what this decision was
   made on.
2. **[DONE]** New `libs/ai-providers/src/openai-chat-provider.ts` (`OpenAiChatProvider`), same
   `ChatProvider` contract as Vertex/Claude, reuses the existing `parseSseJsonStream` helper.
3. **[DONE]** `chat.providers.ts`'s fallback branch swapped from `ANTHROPIC_API_KEY`/
   `ClaudeChatProvider` to `OPENAI_API_KEY`/`OpenAiChatProvider`. Vertex stays primary, unchanged.
   `ClaudeChatProvider` left in the codebase, deliberately unwired (unused import removed from
   `chat.providers.ts` to keep lint clean) — user's explicit instruction, in case the fallback slot
   moves back.
4. **[DONE]** ADR-0008 amended with a dated subsection recording this as a deliberate cost-driven
   trade-off against Claude's documented grounding/injection-resistance rationale (not a retraction
   of that reasoning), plus the compliance gap this opens (OpenAI's zero-retention DPA / EU-residency
   terms unverified) and the Hebrew-quality gap (gpt-5-mini was never a chat-fallback candidate in
   this ADR's own eval scope).
5. **[DONE]** `deploy/docker-compose.yml`/`.env.example`/`README.md` updated with `OPENAI_API_KEY`.
6. **[DONE]** OCI Vault secret `kms-kms-provider-openai-fallback` rotated with the real key,
   verified via SHA-256 hash comparison only (never full content) — after a real incident this pass
   (below).
7. **[DONE]** `pnpm --filter @kms/ai-providers build/lint`, `pnpm --filter @kms/api build/lint`,
   and both packages' `test:unit` all clean (13 + 36 tests passing).

### Real incident this pass: a secret was briefly printed in cleartext

While rotating the Vault secret, a copy-paste error used `anthropic-fallback`'s OCID instead of
`openai-fallback`'s, overwriting the wrong placeholder with the real key. Caught and fixed (reverted
`anthropic-fallback` to its placeholder, correctly rotated `openai-fallback`) — but the **re-verification
step itself printed the full real key in cleartext** in a tool result (a stale/propagation-lag read:
OCI Vault secret updates take a few seconds between `current-version-number` bumping and the bundle
endpoint serving the new content; reading before `lifecycle-state` reaches `ACTIVE` can return
stale — in this case still-previous-version — content, which looked like the secret hadn't rotated
but was actually just a bad-timing read of old data). User caught it, rotated the exposed key
themselves, and asked for more care. Fixed process going forward (this session and recorded in
memory, `feedback_never_print_full_secrets.md`): verify secret rotation via SHA-256 hash comparison
only, never fetch full content; poll `lifecycle-state` until `ACTIVE` before treating any bundle
read as authoritative.

## Next steps (not started, for whoever picks this up)

1. Deploy: build+push `api`/`portal-api`/`web`/`worker` arm64 images, copy `vertex-key.json` +
   updated `.env` to the VM, `docker compose pull && up -d` (`deploy/README.md`'s existing flow,
   now including the worker services and Vertex credential file).
2. Enable `featureToggles.llm` for a real/beta tenant (via `portal-api`'s platform-admin endpoints)
   before chat is reachable at all.
3. Live-verify a real end-to-end chat message in production: upload a document, wait for the worker
   pipeline to index it, ask a question, confirm a grounded, cited, real-Gemini-generated answer —
   the standing live-verification practice for every feature in this project so far, not yet done
   for this one against production because deploy itself is on hold.
