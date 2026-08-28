# Full RAG chat: ingestion pipeline (Phase 3) + retrieval-grounded chat (Phase 4)

Status: PLANNED → implementing immediately. Written/approved 2026-08-28.

## Context

The user asked to "implement the LLM chat." This project's own docs (`CLAUDE.md`, ADRs 0002/0003/0006/0008, `docs/requirements_v02.md` §10) treat chat as Phase 4, explicitly deferred, and dependent on Phase 3 ingestion (parse/chunk/embed/index) which is also deferred — there was nothing to retrieve or ground a chat answer in. When asked to confirm scope, the user chose the full path: real ingestion feeding a real retrieval-grounded chat, not a bare LLM chat with no document grounding.

Key facts driving the design (three research passes + one design pass, all spot-checked against the live repo):

- `apps/worker` was a bootstrap shell (pool selection only, no BullMQ `Worker`/`Queue`, no Nest app, no Mongoose connection). `libs/storage` is fully built and reusable. `libs/ai-providers` was a one-line placeholder. No `chunks`/`conversations`/`messages` schema existed anywhere.
- ADR-0008's provider decision (Vertex Gemini + `text-multilingual-embedding`) is **Accepted but conditional** on a Hebrew benchmark gate that cannot run — `test/evals/` is empty, corpus authoring hasn't started. This plan does not block on that gate.
- No live LLM credentials and no confirmed Atlas Vector Search support on the deployed M0 tier exist in this environment; `mongodb-memory-server` (this repo's entire integration-test harness) cannot execute `$vectorSearch`/`$search` at all.
- `libs/permissions`'s `resolveFolderPermissionsCached` is already a bulk, tenant-wide, Redis-cached permission resolver — ADR-0005 already designates it as the retrieval pre-filter mechanism; no new permission code needed, only a consumer.
- `OwnerScopedRepository` (`libs/data/src/scoped-repository.ts`) already exists and its own doc comment already names `conversations`/`messages` as intended future consumers.
- `'llm'` is already a valid `ModuleName` in `libs/contracts/src/module.ts` — unused until now.

**Governing decision:** follow this codebase's established Fake/real-binding pattern (`StorageProvider`'s `Fake`/`Gcs`/`Oci`/`S3`) for every external dependency this feature needs — embeddings, chat completion, vector retrieval, malware scanning. Each gets a fully-wired Fake that makes the feature genuinely work end-to-end in dev/CI without live credentials or a live Atlas Vector Search index, plus a real implementation written to the literal ADR-specified shape but flagged unverified in this sandbox — same status `GcsStorageProvider`/`OciStorageProvider` already have.

## Mapping to the master phase plan (`docs/plans/implementation-phases-11-07-2026-plan.md`)

That doc is the authoritative task numbering for Phase 3, Lane E1, and Phase 4 — all `[ ]` before this plan. Every task below is tagged with the master-plan id(s) it advances; narrowed/skipped items are stated explicitly, not silently absorbed.

| Master id | Master task | This pass |
|---|---|---|
| 3.1 | BullMQ topology, `WORKER_POOL` boot assertion | Covered |
| 3.2 | clamd service + scan stage | **Narrowed** — `ScanProvider` interface + control flow covered; real clamd binding written but unverified; Fake pass-through actually runs |
| 3.3 | parse stage, sandboxed-pool guards | Covered |
| 3.4 | Failure taxonomy + circuit breaker | **Not built this pass** |
| 3.5 | Chunk stage: splitting, lang detect, page mapping | Covered |
| 3.6 | OCR stages (Classic + Advanced) | **Cut** |
| 3.7 | Processing-queue UI | **Not built this pass** |
| 3.8 | Poison-file corpus, idempotency, breaker-under-load tests | **Narrowed** — idempotency + EICAR-style reject at unit level; full poison corpus/breaker-load tests not built |
| E1.1 | Author Hebrew golden datasets | **Cut** |
| E1.2 | Eval harness runnable in CI | **Cut** |
| 4.1 | embed + index stages, real Atlas indexes | **Narrowed** — stages covered vs. Fake retrieval; real Atlas index creation out of scope |
| 4.2 | `libs/ai-providers` adapters | **Narrowed** — Fake adapters fully wired; real Vertex/Claude adapters written, unverified |
| 4.3 | `buildScopedRetrievalQuery` | Covered (as `retrieveScoped`) |
| 4.4 | **Run the ADR-0008 gate, finalize provider commitment** | **Not done this pass** — blocked on E1, also cut. Largest real gap vs. master Phase 4 exit criteria |
| 4.5 | Chat: prompt architecture, fail-closed grounding, streaming, citations, follow-ups, locked-down renderer | Covered, vs. Fake chat provider |
| 4.6 | Cost/limit controls incl. spend alerts vs. `usageEvents` | **Narrowed** — rate limit + budget-exhausted response covered; spend-alert reconciliation not built |
| 4.7 | Chat/search UI | Covered (chat only; standalone search UI not built) |
| 4.8 | Eval suites, prompt-canary in CI | **Cut** — depends on E1 |

**Net effect:** Phase 3 exit criteria partially met (no real breaker to prove outage handling). Phase 4 exit criteria **not met** — grounded/cited/permission-correct chat works vs. Fakes, but the benchmark gate never runs, so ADR-0008 stays provisional and the master plan's Phase 4 should stay open after this lands. Master-plan checkboxes get updated item-by-item, not blanket `[DONE]`.

## Design

See full design rationale captured during planning (ingestion/retrieval testability seam, BullMQ wiring, malware scan, parsing/chunking, AI providers, chat schemas, permission-scoped retrieval, chat controller/streaming, frontend) — summarized in the task ledger below; each task's implementation should follow the conventions already established elsewhere in this codebase (`documents.controller.ts`/`folders.controller.ts` for controller shape, `documents.providers.ts` for env-precedence provider factories, `folder-exception.filter.ts` for exception filters, `folders-api.ts`/`folders/[id]/page.tsx` for the frontend shape).

## Explicit scope cuts

- Real Atlas Vector Search verification — cut (M0-tier support itself unconfirmed).
- Real ClamAV — cut (Fake pass-through runs; real binding written, unverified).
- Hebrew-benchmark eval-gate run — cut (separate lane).
- OCR stages — cut (image/text-sparse pages index as empty).
- Real BullMQ Redis round-trip in CI — best-effort/manual only (processor logic fully unit-tested regardless).
- Conversation auto-titling/rename — cut (fixed placeholder title).
- Per-tenant budget admin UI — cut (check/response exists, config screen doesn't).
- Spend alerts/observability dashboards — cut.
- Follow-up-suggestion quality — minimal mechanical implementation only.

## Task ledger

**Part 1 — Ingestion (advances Phase 3; unblocks Part 2):**

| # | Task | Master id | Done |
|---|---|---|---|
| 1 | `libs/data`: `chunk.schema.ts` + `chunks.repository.ts` + tests | 3.5, 4.1 | [DONE] — 5/5 repo tests; also wired chunk cleanup into `DocumentsController.delete`/`.update` (move) since stale/orphan chunks would be a real retrieval-permission leak, not just data staleness — 44/44 controller tests green |
| 2 | `libs/data`: `conversation.schema.ts` + `chat-message.schema.ts` + repositories + tests | 4.7 prereq | [DONE] — `ConversationsRepository`/`ChatMessagesRepository` first real `OwnerScopedRepository` consumers; 9 new tests incl. fail-closed-without-ownerUserId case; full `libs/data` suite 19/19 suites, 112/112 tests green |
| 3 | `libs/parsing`: pdf/docx parsers, chunker, lang-detect + tests | 3.3, 3.5 | [DONE] — new package, 19/19 tests (chunker paragraph/hard-cut/overlap/page-boundary cases, lang-detect he/en/mixed, pdf-parser via mocked pdf-parse incl. page-ceiling + low-text-page flag, docx-parser via real JSZip zip-bomb entry/byte-ceiling guards + mocked mammoth) |
| 4 | `libs/storage`: `scan-provider.ts` (Fake + Clamd) + tests | 3.2 narrowed | [DONE] — 12 new tests incl. EICAR-reject and a real in-process fake-clamd TCP server exercising the actual INSTREAM wire framing (not mocked); found + fixed a pre-existing dist/*.spec.js test-duplication gap in libs/storage's (and libs/parsing's) jest config while at it |
| 5 | `libs/ai-providers`: `EmbeddingProvider` interface, `FakeEmbeddingProvider`, `VertexEmbeddingProvider` + tests (`ChatProvider` moved to Part 2 Task 1 per the plan's own sequencing) | 4.2 narrowed | [DONE] — 8/8 tests incl. a real ranking-correctness assertion (query ranks its own chunk above an unrelated one), replaced the one-line placeholder |
| 6 | `libs/config`: `REDIS_QUEUE_HOST` schema (named to match `deploy/docker-compose.yml`'s already-anticipated env var and `REDIS_APP_HOST`'s existing convention — adjusted from the plan's draft `REDIS_QUEUE_URL` name) | 3.1 | [DONE] — 2/2 tests |
| 7 | `apps/worker`: `worker.module.ts` (Nest application context — no HTTP layer) | 3.1 | [DONE] — also added `StorageProvider.getObject` (server-side byte fetch, absent before — only signed-URL issuance existed) across all 4 bindings + `libs/storage`'s `selectStorageProviderFromEnv` shared factory, both real gaps this stage needed |
| 8 | `apps/worker/src/jobs/*.processor.ts`: scan/parse/chunk/embed/index as plain testable functions + tests (path is `src/jobs/**`, not `src/queues/**` as drafted — matches this repo's existing `SystemScope`-import eslint allowlist glob) | 3.1, 3.5 | [DONE] — 15/15 tests |
| 9 | `apps/worker`: `main.ts` rewritten for real BullMQ `Worker`s per pool + producer `Queue` clients for every stage, CLS-scoped per job via a synthetic system-actor `Scope` (not `SystemScope` — each job is single-tenant, not cross-tenant) | 3.1 | [DONE] — builds clean; live Redis round-trip is the plan's own "best-effort, not CI-gated" scope note (task 12) |
| 10 | `apps/api/documents`: `BullMqIngestionQueue` producer + test | 3.1 | [DONE] — real BullMQ `Queue` against an unreachable port, asserts `enqueueScan` never throws synchronously (the upload request must never fail because of this); full apps/api suite 22/22, 309/309 green |
| 11 | Integration test: real DOCX fixture → processors (in-process) → `chunks` populated, `documents.status = indexed`, version-replace purges prior chunks | 3.8 narrowed | [DONE] — 2/2, real `mongodb-memory-server`, new `apps/worker` harness (`test/support/test-worker-app.ts`). Found + fixed a real Jest footgun: a spec file's top-level `import {...} from './worker.module'` statically evaluates `MongooseModule.forRoot(process.env.MONGO_URI ?? 'localhost:27017')` before `beforeAll` sets `MONGO_URI` — fixed by splitting DI tokens/factories into `worker.providers.ts` (no Mongoose-URI code), matching `apps/api`'s `documents.providers.ts`/`AppModule` split. PDF path only unit-tested via mocked `pdf-parse` (no lightweight way to hand-build a real text-layer PDF fixture here, unlike DOCX's hand-buildable OOXML) |
| 12 | Best-effort live BullMQ smoke check if Redis available | 3.1 | [DONE] — local `redis-server` was available in this sandbox; ran a real BullMQ `Worker`/`Queue` chain across all 5 stages against it (plus a real `mongodb-memory-server`), fed a real DOCX through `POST`-equivalent seeding, and confirmed `documents.status` reached `indexed` with the correct chunk text — a genuine end-to-end live round-trip, not just the in-process version. One-off script, not committed (matches the plan's own "not CI-gated" framing) |

**Part 2 — Chat (advances Phase 4; depends only on Part 1 tasks 1, 5):**

| # | Task | Master id | Done |
|---|---|---|---|
| 1 | `libs/ai-providers`: `ChatProvider` interface, `FakeChatProvider` + `VertexChatProvider`/`ClaudeChatProvider` + tests | 4.2 narrowed | [DONE] — 5 new tests (fail-closed not-found, grounded answer, mechanical follow-ups, real multi-token streaming, never emits a citation-shaped field — citations stay the controller's job per sec §5.1); full `libs/ai-providers` suite 2/2 suites, 13/13 tests |
| 2 | `libs/retrieval`: `RetrievalProvider`, Fake/Atlas impls, RRF fusion, `retrieveScoped()` + tests | 4.3 | [DONE] — new package, 14/14 tests. Found + fixed a real architectural conflict along the way: `ScopedRepository.aggregate()` always prepends `$match` first, but Atlas requires `$vectorSearch`/`$search` to BE the first stage — added `ChunksRepository.vectorSearchScoped`/`.textSearchScoped` (call `model.aggregate()` directly, tenant filter embedded in the stage's own `filter`) and extended `backstop.plugin.ts`'s aggregate tripwire (`isProperlyScopedFirstStage`, 9 new tests) to recognize that shape as valid scoping proof too, not just `$match` |
| 3 | `libs/contracts`: `chat-dto.ts` | 4.5 prereq | [DONE] — matches `document-dto.ts`'s zod-request/plain-response-type pattern exactly; no dedicated spec file, matching every other `*-dto.ts` in this package (exercised indirectly via the controller's `.parse()` calls) |
| 4 | `apps/api/chat`: provider factories, exception filter, rate-limiter wiring | 4.5, 4.6 narrowed | [DONE] — `chat.providers.ts` (embedding/chat/retrieval Fake/real precedence), `chat-exception.filter.ts` (3/3 tests), `chat-budget.ts` reusing `libs/auth`'s existing `RateLimiter` for both the per-user hourly limit and the tenant monthly message-count budget (6/6 tests). Also added `DocumentsPermissionsService.permittedReadFolderIds()` — the full permitted-read set chat's retrieval pre-filter needs, extending the existing tested service rather than duplicating its resolution logic (4 new tests, 18/18 total in that spec) |
| 5 | `apps/api/chat/chat.controller.ts`: all endpoints + tests | 4.5 | [DONE] — 14/14 tests. Added a 6th endpoint beyond the plan's original 5-item sketch: `GET /chat/conversations/:id/messages` (loads a thread's history) — structurally required by PRD §10's "resume" requirement, which the original endpoint list omitted. Full apps/api suite 25/25 suites, 336/336 tests |
| 6 | `AppModule` registration | 4.5 prereq | [DONE] — `Conversation`/`ChatMessage` schemas + repositories + `ChatController` + the three chat provider factories registered |
| 7 | Integration test: real permissions incl. zero-permission user, real chunks, full round trip | 4.8 narrowed | [DONE] — 3/3, real HTTP round trip via supertest against a real Nest app (`mongodb-memory-server`), asserting the fail-closed contrast directly: same question, member gets a real cited answer, zero-permission outsider gets the grounded not-found copy with zero citations. Found + fixed a real, load-bearing bug along the way: `SessionAuthGuard` never populated `Scope.ownerUserId` for a normal tenant session — `OwnerScopedRepository` (conversations/messages' only access path) threw `MissingScopeError` on every real HTTP request, only ever masked because nothing had exercised it end-to-end before this test (`session-auth.guard.spec.ts` +1 test). Also added `@HttpCode(200)` to the streaming endpoint (Nest defaults POST to 201) and bumped `bootstrap.integration.spec.ts`'s timeout to 30s — under this sandbox's CPU contention with 7 concurrent `mongod` integration suites, default 5s timeouts flake on whichever suite the OS schedules last, confirmed environmental (not a logic bug) by a clean 41/41 pass at `--maxWorkers=2` |
| 8 | `apps/web/lib/chat-api.ts` | 4.7 | [DONE] — CRUD via `tenantApi` + hand-rolled `streamMessage()` SSE reader; imports response types directly from `@kms/contracts` (a deliberate, documented deviation from `folders-api.ts`'s hand-mirrored-locals convention, since chat's summary types are actually published there) |
| 9 | `apps/web/components/chat-answer.tsx` | 4.5 | [DONE] — citations render as a "מקורות" chip list below the answer (not inline markers — the providers return prose + a separate citations array, not marker positions, so this is the honest rendering of what's actually generated), paragraph/bold-only text, zero `dangerouslySetInnerHTML` |
| 10 | `apps/web/app/chat/page.tsx` + `[id]/page.tsx` + nav entry | 4.7 | [DONE] — conversation list (create/resume/delete) + thread view (streaming composer, not-found bubble styled distinctly, rate-limit/budget banners, citation chips); enabled the pre-existing (previously `href`-less/disabled) chat nav item in `app-shell.tsx`. Full `next build` green: 20/20 static pages, `/chat` + `/chat/[id]` both compile, zero errors |
| 11 | Live verification (Playwright MCP) | 4.8 narrowed | [DONE] — real dev harness + real browser: login→TOTP→chat, new conversation, a grounded cited answer against a real seeded chunk, citation-chip click (real permission re-verification, opened a new tab, zero errors), delete conversation — zero console errors throughout. **Found and fixed a real gap live**: a permitted-but-irrelevant question ("what's the weather tomorrow?") still returned the one seeded chunk as a "grounded" answer — retrieval only fail-closed on zero *permission*, never on zero *relevance*, leaving half of PRD §10's "not found" requirement (the answer isn't in the corpus) unimplemented. Fixed with `MIN_RELEVANCE_SCORE` (`libs/retrieval`), a semantic-similarity floor applied in both `FakeRetrievalProvider` and `AtlasRetrievalProvider` (4 new tests), explicitly documented as a rough placeholder pending the ADR-0008 eval gate's real calibration — re-verified live afterward: the same weather question now correctly renders the not-found bubble, the budget question still returns the grounded, cited answer |

Not carried into either part: 3.4, 3.6, 3.7, full 3.8 poison corpus, E1.1, E1.2, 4.4, eval-suite/canary half of 4.8 — left `[ ]` in the master plan.

## Verification

- Unit tests per package as work lands, full monorepo `build lint test:unit` pass before considering either part done.
- Part 1 integration test proves real ingestion writes real, correctly-scoped `chunks` via `mongodb-memory-server` — no live Atlas needed.
- Part 2 integration test proves fail-closed retrieval and correct grounded/not-found/citation behavior against Fake providers.
- Live Playwright MCP pass against the real dev harness for the full upload→ask→cite→not-found→delete journey.
