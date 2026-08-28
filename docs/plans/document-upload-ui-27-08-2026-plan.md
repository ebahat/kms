# Document upload UI

Status: PLANNED → implementing immediately (small, bounded scope; backend already exists and is
tested). Written 2026-08-27.

## Origin

User: "I would like to upload documents... How can users upload documents." Confirmed the backend
(`POST /documents`) exists and is fully tested but has no web UI — `/folders/[id]` only lists
documents read-only, with a comment explicitly marking upload as out of scope for the earlier
Phase 2 UI plan. This plan closes that one gap; drag-drop/progress bars/version history (the rest
of UI spec B3–B5) stay out of scope, matching the existing UI's own file-picker convention (CSV
import on `/users`, logo upload on `/admin/tenants/new` — both plain `<input type="file">`, no
drag-drop anywhere in this app yet).

## What exists already (verified by reading the code, not assumed)

- `POST /documents` (`apps/api/src/documents/documents.controller.ts:312`): multipart form, field
  `file` + field `folderId` (24-hex). Order of checks: multer's own 50MB `limits.fileSize` (413 via
  `MulterExceptionFilter`) → magic-byte sniff, PDF/DOCX/JPG/PNG only (415 `UNSUPPORTED_FILE_TYPE`)
  → folder edit-tier check (404, not 403 — denial convention) → tenant storage quota (409
  `STORAGE_QUOTA_EXCEEDED`) → storage write → `Document`/`DocumentVersion` records → ingestion-queue
  stub. Returns `201 {documentId, versionId, versionNumber, status: 'queued'}`.
- `apiErrorMessage()` (`apps/web/lib/api.ts`) already surfaces `e.body.message` when present — the
  413/409/415 responses all carry a human-readable `message`, so no per-code copy needed on the
  client beyond a sensible fallback string.
- `apps/web/lib/api.ts`'s `portalApi` already has a multipart-safe `postForm` (`requestForm()`,
  bypasses the JSON `Content-Type` header so the browser can set its own multipart boundary) — used
  today only for the superuser logo upload. `tenantApi` has no equivalent yet.
- `/folders/[id]/page.tsx` already gates folder-mutating actions on `canEdit = tier === 'edit' ||
  tier === 'manage'` (same tier `canUploadTo` itself requires) — the exact right gate to reuse.

## Design

1. **`apps/web/lib/api.ts`**: add `tenantApi.postForm`, same `requestForm()` helper `portalApi`
   already uses, just pointed at `API_BASE` instead of `PORTAL_API_BASE`.
2. **`apps/web/lib/folders-api.ts`**: add `uploadDocument(folderId, file): Promise<UploadDocumentResponse>`
   calling `tenantApi.postForm('/documents', form)` with a `FormData` carrying `file` + `folderId`.
   Add the `UploadDocumentResponse` type (mirrors the contract's shape, same hand-matched-type
   convention this file already uses for every other FoldersController/DocumentsController response).
3. **`/folders/[id]/page.tsx`**: a file-picker + "העלה קובץ" button next to the existing
   "צור תת-תיקייה" control, shown under the same `canEdit` gate. `accept="application/pdf,.docx,.doc,image/jpeg,image/png"`
   on the input (informational only — the server's magic-byte sniff is the real gate). On select:
   upload immediately (no separate "confirm" step, matching this app's existing single-step CSV
   import pattern), show an inline "מעלה..." busy state, clear the file input, reload the document
   list on success, surface server errors via `apiErrorMessage`.

## Test plan

- No new backend code — existing `documents.controller.spec.ts` (34 tests) and the permission-matrix
  integration suite already cover the upload path itself.
- `apps/web` has no unit-test harness for components (confirmed earlier this session — `test:unit`
  finds zero test files here, matches every other screen in this app). Verification is live,
  through the real dev harness + a real browser: upload a valid PDF/PNG, confirm it appears in the
  document list; attempt an unsupported file type and confirm the 415 message renders; confirm the
  upload button is hidden for a read-only (non-edit-tier) folder.

## Task ledger

| # | Task | Done |
|---|---|---|
| 1 | `tenantApi.postForm` | [DONE] |
| 2 | `foldersApi.uploadDocument` + `UploadDocumentResponse` type | [DONE] |
| 3 | Upload UI on `/folders/[id]` | [DONE] |
| 4 | Live verification (upload success, bad-type rejection, tier gating) | [DONE] — real dev harness + real browser (Playwright MCP). Uploaded a real PNG: appeared in the document table with correct name/size/version/status ("ממתין"), zero console errors. Uploaded a fake `.pdf` (plain text, wrong magic bytes): server correctly 415'd, the exact server message ("Allowed types: PDF, DOCX, JPG, PNG.") rendered via the existing `apiErrorMessage()` path, no runtime errors, no bad row added to the list. Tier gating (button hidden below edit-tier) reuses the identical `{canEdit && (...)}` conditional already covering the subfolder-create button — not re-verified with a separate non-admin session since it's the same, already-proven gate, not new logic. |

`pnpm exec tsc --noEmit`, `pnpm lint` both clean in `apps/web`.
