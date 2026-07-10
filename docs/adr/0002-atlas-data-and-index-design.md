# ADR-0002: MongoDB Atlas Data Model and Search/Vector Index Design

**Status:** Accepted (2026-07-10)
**Date:** 2026-07-07
**Deciders:** Product owner (Ehud); drafted in the architecture/ADR pass
**Sources:** PRD §2, §4, §7, §8, §10, §11, §12, §13, §15, §16; sec §3.3, §7.3, §8.1, §8.2; `requirements_review_v01.md` resolution log

## Status

Accepted 2026-07-10 — step-6 consistency review passed; review fixes applied (findings record in the plan). The embedding dimension in the vector index is parameterized on ADR-0008's Hebrew benchmark gate.

## Context

The data platform is settled: MongoDB Atlas collections + Atlas Vector Search + Atlas Search (keyword), tenant-filtered, on a single shared cluster (PRD §4, §16; resolution log). Within that, this ADR fixes the collection layout, the chunk schema, the index definitions, and the literal query shapes, under these constraints:

- Tenant filter **and** folder-permission filter must be applied *inside* the Atlas Search / Vector Search query (pre-filter), never as post-filtering (sec §3.3; PRD §10 "enforced in the retrieval query itself").
- Hybrid search: semantic vectors + keyword BM25, so exact terms — dates, protocol numbers, names — rank correctly (PRD §10).
- Hebrew-first: tolerance for common prefixes (ו/ה/ב/ל) via tokenizer normalization; **no** morphological stemming in MVP; exact-term matching is the priority (PRD §2).
- Only the latest document version is indexed; superseded vectors are purged immediately on new-version ingestion (PRD §8). Deletion removes a document from the index immediately (PRD §8), and deletion must be verifiable across DB + both indexes + storage (sec §7.3).
- Audit trail: immutable, append-only, tenant-segregated, ≥ 24-month retention (PRD §12; sec §8.1).
- Smart-OCR-edition files are never added to any search index (PRD §15).
- Scale: ~4,000 documents / 20 tenants / 8,000 users at MVP; must not preclude 10× (PRD §13). Even at 10× (~40k documents, ~4M chunks at ~100 chunks/doc), this is small for Atlas Search — index design is driven by correctness and Hebrew behavior, not capacity.

## Collections

All tenant-owned collections carry a mandatory `tenantId` (enforced per ADR-0001) as the **first field of every compound index**, so every query is index-covered within its tenant slice.

| Collection | Purpose | Key fields / notes |
|---|---|---|
| `tenants` | Tenant registry, quotas, feature toggles, edition | Managed only from the platform-admin realm (PRD §5) |
| `users` | Internal user directory | TOTP secret & backup codes field-level encrypted (sec §7.2); PRD §6 |
| `groups` | Tenant user groups | PRD §7 |
| `folders` | Nested hierarchy, max depth 10 | `path` (materialized ancestor array) for inheritance resolution (PRD §7, §8); permission grants per ADR-0005 |
| `documents` | Current-state document metadata | `folderId`, `status` (queued/processing/indexed/failed, PRD §8), `latestVersionId`, quota accounting fields (PRD §4) |
| `documentVersions` | Immutable version records | Storage key, content hash, size; prior versions retained and quota-counted (PRD §8) |
| `chunks` | Retrieval unit — text + embedding | Schema below; only latest-version chunks exist (PRD §8) |
| `conversations` / `messages` | Per-user chat history | Carry `ownerUserId`; accessed **only** via `OwnerScopedRepository` (ADR-0001) so tenant admins cannot read them (sec §3.5); 12-month default retention (PRD §14); messages separate to avoid unbounded array growth |
| `auditEvents` | Append-only audit trail | No update/delete code path (sec §8.1); PRD §12 coverage list |
| `usageEvents` | Metering: pages, tokens, storage, chat | Survives file deletion — Smart OCR metering outlives the 7-day purge (PRD §15); feeds §5 analytics/billing |
| `ocrFiles` | Smart-OCR edition file records | Accessed **only** via `OwnerScopedRepository` (ADR-0001; sec §3.6); `expiresAt` TTL-driven 7-day hard deletion (PRD §15) |
| `recycleBinEntries` | Deleted-document records awaiting purge | `purgeAfter` (default +30 d, PRD §8), recorded object keys + content hash (PRD §8 audited deletions); consumed by ADR-0006's purge job |
| `deletionVerifications` | Outputs of deletion-verification jobs | Asserted evidence per sec §7.3 (0 chunks / 0 index hits / object 404s); source data for offboarding certificates (PRD §14; ADR-0006) |

### Chunk schema (the retrieval unit)

```ts
{
  _id: ObjectId,
  tenantId: ObjectId,        // vector+search pre-filter field (sec §3.3)
  folderId: ObjectId,        // permission pre-filter field (sec §3.3; PRD §7) — denormalized from document
  documentId: ObjectId,
  versionId: ObjectId,       // exactly one indexed version per document (PRD §8)
  seq: number,               // chunk order within the document
  page: number | null,       // for page-level citations (PRD §10)
  text: string,              // raw chunk text (Atlas Search field)
  embedding: number[],       // Vector Search field; dimension per ADR-0008
  embeddingModel: string,    // e.g. "vertex/text-multilingual-embedding-002@768" — enables re-embedding migrations
  lang: 'he' | 'en' | 'mixed' // detected at chunking (PRD §2 mixed-language documents)
}
```

`folderId` is denormalized onto chunks so the permission filter is a local field comparison inside the index (sec §3.3). When a document moves folders, the ingestion service updates its chunks' `folderId` in the same operation that re-applies destination permissions (PRD §8 "moving a document re-applies the destination folder's permissions").

## Options Considered

Cluster-level isolation (shared vs. per-tenant databases) is settled by PRD §4 and not reopened. The open choices are (1) index topology and (2) Hebrew analyzer strategy.

### Option A: Single shared `chunks` collection; one vector index + one search index with tenant/folder filter fields (chosen)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — one collection, two index definitions, one query shape |
| Isolation mechanism | Pre-filter on `tenantId` + `folderId` inside every query (sec §3.3) |
| Scalability | Fine to 10× (≈4M chunks); Atlas Search handles this on modest tiers (PRD §13) |
| Ops burden | Low — index changes are one rollout, not 20+ |

- **Pros:** Matches the settled shared-cluster model (PRD §4); tenant onboarding needs no index provisioning (PRD §5 tenant lifecycle); one code path to test in the cross-tenant CI suite (sec §10).
- **Cons:** Isolation rests entirely on the pre-filter being present — a missing filter is a cross-tenant leak. Mitigated by ADR-0001's layered guards plus the query-builder rule below (retrieval queries are built by one audited function).

### Option B: Collection-per-tenant chunks with per-tenant indexes

| Dimension | Assessment |
|-----------|------------|
| Complexity | High — dynamic model registry, 20+ index definitions, migration fan-out |
| Isolation mechanism | Physical separation (stronger by construction) |
| Scalability | Atlas Search index count grows with tenants; churn on onboard/offboard |
| Ops burden | High — every analyzer/mapping change ×N tenants; platform analytics (PRD §5) need cross-collection fan-out |

- **Pros:** A missing filter cannot cross tenants; per-tenant offboarding is a collection drop (clean for PRD §14 verified deletion).
- **Cons:** Contradicts the spirit of the settled single-shared-cluster + repository-scoping decision (PRD §4, sec §3.1); Atlas Search per-index overhead and index-count limits make 10× tenant growth (200 tenants) operationally hostile; every schema/analyzer iteration during MVP multiplies by tenant count.

**Decision on topology: Option A**, with the compensating controls from ADR-0001 and the single-query-builder rule below.

### Hebrew prefix handling — Option H1: dual-analyzer multi field in Atlas Search (chosen)

Index `chunks.text` twice: an exact field (standard tokenizer, lowercase) and a `heb_norm` multi field whose analyzer strips leading Hebrew prefix letters. Queries hit both, boosting exact matches — implementing PRD §2's "exact-term matching is the priority" ordering.

```jsonc
// Atlas Search index "chunks_text" (analyzer section)
{
  "analyzer": "lucene.standard",
  "mappings": {
    "dynamic": false,
    "fields": {
      "tenantId": { "type": "objectId" },
      "folderId": { "type": "objectId" },
      "text": {
        "type": "string",
        "analyzer": "lucene.standard",        // exact tokens — priority path (PRD §2)
        "multi": {
          "heb_norm": { "type": "string", "analyzer": "hebrew_prefix_norm" }
        }
      }
    }
  },
  "analyzers": [
    {
      "name": "hebrew_prefix_norm",
      "tokenizer": { "type": "standard" },
      "tokenFilters": [
        { "type": "lowercase" },
        // strip up to two leading particle letters (ו/ה/ב/ל/כ/מ/ש) from tokens ≥ 4 chars,
        // so the token minus prefix stays a plausible word (PRD §2 prefixes)
        { "type": "regex", "pattern": "^[והבלכמש](?=[\\u05D0-\\u05EA]{3,})", "replacement": "", "matches": "first" },
        { "type": "regex", "pattern": "^[הבלכמש](?=[\\u05D0-\\u05EA]{3,})", "replacement": "", "matches": "first" }
      ]
    }
  ]
}
```

- **Pros:** Pure index configuration — no pipeline changes; both document and query text pass through the same analyzers, so `ההסכם`, `והחוזה`-style query/document mismatches meet in the normalized field; exact field keeps dates/protocol numbers/names ranking first (PRD §2, §10).
- **Cons:** Blind prefix stripping over-strips words genuinely starting with those letters (e.g., הסכם → סכם) — acceptable because it only *adds* recall in the low-boost field while the exact field preserves precision; the two-step regex approximates "up to two prefixes" and its behavior on PRD §2's examples must be verified against a live Atlas index during implementation (risk logged in the plan).

### Hebrew prefix handling — Option H2: application-side token expansion at chunking (fallback)

At chunk time, generate a shadow `textNorm` field containing prefix-stripped variants using a rule-based Hebrew normalizer in the ingestion worker; index it with `lucene.standard`.

- **Pros:** Full control (real linguistic rules, can emit both original and stripped forms — no over-stripping loss); testable in unit tests without Atlas.
- **Cons:** Query text must be normalized by the same code path at search time; adds pipeline logic and storage; drifts from "tokenizer normalization" as described in PRD §2.

**Decision on Hebrew: H1**, with H2 as the pre-identified fallback (per the plan's risk register) if H1 fails validation against PRD §2 example queries.

## Decision

### Vector index (literal definition)

```jsonc
// Atlas Vector Search index "chunks_vector" on collection "chunks"
{
  "fields": [
    { "type": "vector", "path": "embedding",
      "numDimensions": 768,            // Vertex text-multilingual-embedding family; final value gated by ADR-0008
      "similarity": "cosine" },
    { "type": "filter", "path": "tenantId" },
    { "type": "filter", "path": "folderId" }
  ]
}
```

### Retrieval query shapes (literal, as required by the plan)

All retrieval queries are produced by **one audited builder function** (`buildScopedRetrievalQuery`) in the chunks repository — a security-sensitive CODEOWNERS path (sec §10). `permittedFolderIds` comes from the effective-permission computation (ADR-0005); `tenantId` from the CLS scope (ADR-0001). Empty `permittedFolderIds` short-circuits to *no retrieval call at all* — fail-closed grounding (sec §5.4).

```js
// Semantic arm — $vectorSearch with pre-filter (sec §3.3)
{
  $vectorSearch: {
    index: "chunks_vector",
    path: "embedding",
    queryVector: <queryEmbedding>,
    numCandidates: 200,
    limit: 20,
    filter: {
      tenantId: { $eq: <sessionTenantId> },        // never from request input (sec §3.1)
      folderId: { $in: <permittedFolderIds> }      // permission pre-filter (sec §3.3, PRD §10)
    }
  }
}

// Keyword arm — $search compound: filter clauses enforce scope, should clauses rank (PRD §2 priority)
{
  $search: {
    index: "chunks_text",
    compound: {
      filter: [
        { equals: { path: "tenantId", value: <sessionTenantId> } },
        { in:     { path: "folderId", value: <permittedFolderIds> } }
      ],
      should: [
        { text: { query: <userQuery>, path: "text", score: { boost: { value: 3 } } } }, // exact tokens first
        { text: { query: <userQuery>, path: { value: "text", multi: "heb_norm" } } }    // prefix-normalized recall
      ],
      minimumShouldMatch: 1
    }
  }
}
```

**Hybrid fusion:** the two arms run as separate aggregations and are merged with reciprocal rank fusion (RRF, k=60) in the API layer for MVP (PRD §10 hybrid requirement). Application-side RRF is chosen over Atlas `$rankFusion` because it works on any current cluster version and keeps the exact-term boost tunable per PRD §2; migrating to server-side `$rankFusion` is a noted future consolidation, not an MVP dependency.

### Versioning, deletion, and the indexes

- **New version ingestion:** delete all chunks where `{tenantId, documentId}` (old version), then insert the new version's chunks, then set `documents.status = indexed`. Delete-first honors "superseded vectors are purged immediately" (PRD §8); the document already shows `processing` during the window, so no state serves two versions.
- **Document deletion:** chunk deletion is step 1 (index removal is immediate, PRD §8); the source file moves to the recycle bin for the retention window (PRD §8). The deletion-verification job (sec §7.3) asserts zero chunks and zero Atlas Search hits for the `documentId` before certifying.
- **Smart OCR edition:** `ocrFiles` content is never written to `chunks` — structurally, the ingestion index stage is absent from that edition's pipeline (PRD §15; ADR-0003).

### Audit store

`auditEvents` is append-only by construction: its repository exposes only `create` and `find` (no update/delete methods exist to call — sec §8.1), Mongoose schema is `strict`, and a daily job exports the day's events, hash-chained, to a write-once (object-lock) storage bucket so even platform operators cannot rewrite history (sec §8.1). Compound index `{tenantId, ts}` keeps tenant-admin audit reads segregated and fast (PRD §12). Platform-realm actions (PRD §5, §12; ADR-0001 `SystemScope.run`) have no tenant owner: they carry `scope: 'platform'` with `tenantId: null` and are indexed `{scope, ts}` — tenant-admin audit queries filter on their own `tenantId` and can never see them, while platform-audit reads live only in the portal realm (ADR-0004). Raw query text lives only here, not in application logs (sec §8.2).

### Supporting B-tree indexes (initial set)

`chunks {tenantId, documentId}` (purge path); `documents {tenantId, folderId}`, `{tenantId, status}`; `folders {tenantId, path}`; `messages {tenantId, conversationId, ts}`; `auditEvents {tenantId, ts}`; `usageEvents {tenantId, userId, period}` (PRD §5/§9 metering rollups); `ocrFiles {tenantId, ownerUserId}` + TTL on `expiresAt` (PRD §15) — TTL deletion is *followed* by the verification job (sec §7.3), not trusted alone.

## Consequences

- **Positive:** One collection + two indexes serve both search arms with identical scoping semantics, so the cross-tenant CI suite (sec §10) exercises the real production query path; page-level citations come free from chunk metadata (PRD §10); re-embedding migrations (ADR-0008 provider swap) are a per-`embeddingModel` backfill, not a schema change.
- **Negative / accepted risks:** Correctness of Hebrew prefix normalization rests on Atlas's `regex` token filter behaving as designed — validated against PRD §2 examples before implementation, with H2 as the funded fallback. `folderId` denormalization onto chunks means folder moves touch many chunk documents — bounded at ~100 chunks/doc × per-move, trivial at MVP scale (PRD §13). Chunk `$in` permission filters bound to the size of a user's permitted-folder set — cardinality analysis and the escape hatch (permission-group tokens) are ADR-0005's responsibility per the plan's risk register.
- **Follow-ups:** ADR-0005 defines how `permittedFolderIds` is computed and its 10× cardinality bound; ADR-0003 owns the pipeline stages that write/purge chunks; ADR-0008 fixes `numDimensions` and the embedding model behind the benchmark gate; analyzer validation task (H1 vs PRD §2 examples) goes into the implementation-phase test plan.
