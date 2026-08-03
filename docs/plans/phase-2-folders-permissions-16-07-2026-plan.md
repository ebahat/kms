# Phase 2 Implementation Plan — Folders, Permissions, File Storage

**Date:** 2026-07-16 · **Status:** IN PROGRESS
**Scope:** `docs/plans/implementation-phases-11-07-2026-plan.md` Phase 2, items 2.1–2.7
**Sources:** ADR-0002 (data model), ADR-0005 (RBAC resolution), ADR-0006 (storage/signed URLs), ADR-0003 (ingestion — enqueue contract only, workers are Phase 3), ADR-0001 (tenant scoping, reused throughout)

## Sequencing

Same discipline as Phase 1: each item lands with its own tests, verified via a real
`pnpm turbo run build lint test:unit` before moving to the next. Items build on each
other in this order:

1. **2.1 Folders + groups** — schemas/repositories, cardinality guard
2. **2.2 Permission resolution** — pure resolver in `libs/permissions` + versioned Redis cache
3. **2.3 Documents + upload path** — schemas/repositories, streaming upload, storage abstraction
4. **2.4 Serving** — signed-URL download, permission re-check at issuance
5. **2.5 Recycle bin + deletion verification**
6. **2.6 Web UI** — folder tree, upload, document list, permission/group screens
7. **2.7 Cross-cutting tests** — permission matrix, 404-not-403, signed-URL expiry/tamper — woven in per-item per working rule 3, closed out with a final integration pass

## Key design decisions (made now, to avoid mid-flight re-litigation)

- **Storage abstraction, not a new workspace lib.** ADR-0006 calls for "one audited
  function" for key construction + signed-URL issuance, not a shared library — no ADR
  mandates a `libs/storage` package, and only `apps/api` needs this in Phase 2. A
  `StorageProvider` interface (mirrors the existing `KmsKeyProvider` pattern in
  `libs/auth`) lives in `apps/api/src/documents/storage/`, with a `GcsStorageProvider`
  (real, using `@google-cloud/storage`, uninstantiable without live credentials — not
  exercised) and an in-memory `FakeStorageProvider` for tests. Extract to a shared lib
  only when Phase 3/5 actually need it elsewhere (YAGNI).
- **Enqueue is a stub, not a real BullMQ producer.** Phase 3 (item 3.1) is where BullMQ
  topology gets built from scratch; Phase 2's upload path only needs the structural
  hook. `IngestionQueue` is an interface with a no-op logging stub, following the same
  "interface now, real adapter later" pattern already used for `CaptchaVerifier` /
  `SecurityAlertSink`. `documents.status` starts at `queued` regardless.
- **`permVersion` lives in Redis (`redis-app`), not Mongo.** ADR-0005 requires the grant
  write and version bump to be effectively atomic from the cache's point of view — a
  full Mongo multi-document transaction is more machinery than this needs. Grant write
  (Mongo) happens first, then `INCR permVersion:{tenantId}` (Redis) — same
  best-effort sequential-write pattern already used elsewhere in this codebase (e.g.
  deactivate-then-revoke-sessions in 1.5). A crash between the two steps only means a
  stale cache read for the narrow window until the next change or TTL — not a
  correctness violation, and the ADR's own accepted-risk section already tolerates
  coarse/lazy invalidation.
- **Recycle-bin purge is a pure, unit-tested function, not a scheduled job yet.**
  `apps/worker`'s pools (`parse|ai|index`) don't include a purge pool, and cron/schedule
  wiring is infrastructure Phase 2 doesn't need to invent. `runRecycleBinPurge(now,
  deps)` is written and tested now; wiring it to a real scheduler is a Phase 3/6
  follow-up (recorded as such, not silently dropped).
- **No live MongoDB/GCS/Redis in this sandbox** (same caveat as Phase 1) — everything
  is verified via unit tests against mocked/fake dependencies (`mongodb-memory-server`
  where the existing test setup already uses it, `ioredis-mock`, `FakeStorageProvider`).
  Live-infra verification remains blocked on a provisioned GCP project, same as noted in
  the root CLAUDE.md.

## Exit criteria (unchanged from the phase map)

A user sees exactly their permitted tree; grant changes take effect within the
cache-version rules; deletion produces a verification record; all P2 tests green.

---

Progress is tracked inline below as items complete; update statuses here as the phase
goes rather than only in the top-level plan file.

- [DONE] 2.1 Folders + groups — `libs/data/src/models/{folder,group}.schema.ts`, `FoldersRepository`/`GroupsRepository` (`libs/data/src/repositories/`), `FolderLimitExceededError`/`FolderDepthExceededError`. `createFolder()` enforces `MAX_FOLDERS_PER_TENANT` (2000, ADR-0005) and `MAX_FOLDER_DEPTH` (10, PRD §8) before insert. 7 new unit tests (26 total in `libs/data`); build/lint/test:unit green.
- [DONE] 2.2 Permission resolution — new `libs/permissions` package: `resolveFolderPermissions` (pure function — inheritance/override, direct+group union, three-tier `manage>edit>read`, public folders) and `computeFolderWidening` (ADR-0005's 2026-07-19 amendment — per-folder `broaderThanParent`/`addedGroups`/`becamePublic`, correctly treats a fully-public parent as un-broadenable). `PermissionCache` wraps redis-app with the versioned `{tenantId,userId,permVersion}` keying (ADR-0005 Option C); `resolveFolderPermissionsCached`/`computeFolderWideningCached` compose cache-or-compute with try/catch fallback to direct computation on any Redis error and best-effort (swallowed) cache writes, matching the ADR's "the service must implement that fallback, not fail." `adapters.ts` converts `@kms/data` Mongoose documents to this package's plain-string-id types (keeps `mongoose` imports confined to `libs/data`, ADR-0001). Also fixed a real pre-existing gap: `FolderGrant.access` only had `'read'|'edit'`, not the three tiers ADR-0005 was amended to require. 41 new unit tests; two real bugs caught and fixed via testing (a public parent wasn't treated as unbeatable-broad; `ioredis-mock` shares a global store across instances, needed explicit `flushall()` per test for isolation). `pnpm turbo run build lint test:unit` green across all 30 workspace tasks; `snyk_code_scan` clean on the new code (2 unrelated low-severity findings in a pre-existing Phase-1 test file, out of scope). Not yet wired into `apps/api` HTTP routes/guards — that lands with 2.3/2.4/2.6 as each needs it.
- [DONE] 2.3 Documents + upload path — `libs/data`: `Document`/`DocumentVersion` schemas + `DocumentsRepository`/`DocumentVersionsRepository` (`createDocument`/`createVersion` both accept an optional pre-generated `_id` so the storage key can be built, and the bytes durably written, *before* either Mongo record exists — storage-first ordering avoids a DB row ever pointing at bytes that were never stored); `sumSizeForTenant()` for the quota gate. New `newObjectId()` helper on `libs/data` (mirrors `toObjectId`) so no other package needs to import `mongoose` directly. `apps/api/src/documents/`: `StorageProvider` interface + `FakeStorageProvider` (wired) + `GcsStorageProvider` (real `@google-cloud/storage`, uninstantiable without live credentials — not exercised, falls back to Fake when `GCS_DATA_BUCKET` is unset); `sniffFileType` magic-byte detector (PDF/PNG/JPG signatures + a ZIP-plus-OOXML-marker check for DOCX, so a renamed file is caught by content, never by extension/client MIME — sec §4.4); `IngestionQueue` interface + no-op `LoggingIngestionQueue` stub (Phase 3 wires the real BullMQ producer); `DocumentsPermissionsService` — **the first real consumer of `libs/permissions`**, resolving folder edit-access via the cached resolver, with a tenant-admin bypass and 404 (never 403) on both a missing folder and a denied grant. `DocumentsController`: `POST /documents` (new document) and `POST /documents/:id/versions`, enforcing the ADR-0006/sec-§4.4 order — multer's `limits.fileSize` bounds memory to 50 MB before anything else runs, then magic-byte sniff, then the permission check, then the quota gate (soft/advisory, documented as a non-atomic read-then-compare — PRD §4's 80%/95% alerts, not a security boundary), then the storage write, then the Mongo records, then the ingestion-queue stub. A scoped `MulterExceptionFilter` (controller-level, not global) maps multer's raw `LIMIT_FILE_SIZE` error to a clean 413. 39 new unit tests across the touched packages; `pnpm turbo run build lint test:unit` green across all 30 workspace tasks (incl. `apps/web`, `apps/portal-api`, both unaffected); `snyk_code_scan` clean on every new file. Not yet built (correctly deferred): signed-URL download (2.4), recycle bin (2.5), any UI (2.6) — and no live GCS/Mongo has ever exercised this path, same caveat as every prior phase item.
- [ ] 2.4 Serving (signed URLs)
- [ ] 2.5 Recycle bin + deletion verification
- [ ] 2.6 Web UI
- [ ] 2.7 Cross-cutting test pass
