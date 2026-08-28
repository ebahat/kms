# Document file actions: rename, move (with a real directory picker), and metadata columns

Status: PLANNED → implementing immediately. Written 2026-08-28.

## Origin

User: "See the ui design under `tmp/stitch_automated_document_reviewer 2/` and `tmp/stitch_automated_document_reviewer (1)/` — implement the directory structure view and file actions - move, edit, rename and also the 'last opened', 'upload time' and 'last update' and picking a new directory when moving a file."

## Reading the design references

- `tmp/stitch_automated_document_reviewer 2/c2.1_folder_management/` and `c2.1_folder_actions_management/`: a folder-listing table with columns שם התיקייה (name) / קבצים (file count) / **זמן העלאה (upload time)** / **עודכן לאחרונה (last updated)** / **נפתח לאחרונה (last opened)** / פעולות (actions). Per-row actions: inline rename (pencil → text input → checkmark to confirm), delete, move ("העבר"), plus a kebab (⋮) menu. The `_actions_management` variant adds checkboxes and a floating bulk-action bar (download/move/delete) when rows are selected.
- `tmp/stitch_automated_document_reviewer (1)/`: the "העbר אל" (Move to) modal — search box + an expandable folder tree, single-select (checkmark on the chosen folder), "העבר לכאן" (Move here) / "ביטול" (Cancel).
- `implementation_requirements_document_upload_directory_management.md`: broader doc (upload flow, OCR, quota, search) — most of it is already-out-of-scope territory per this project's own v1.0 cut (Phase 3 ingestion/OCR, search). Only §2.B ("Move/Copy... 'Move to' dialog", "Renaming: in-line editing") is this plan's actual scope.

**Scope decisions, stated explicitly so they're not silently assumed:**
1. **"Directory structure view" = the existing `/folders` + `/folders/[id]` browser**, extended — not a new separate flat "admin folder management" table screen. The mockups are styled as a management table, but this app already has a working tree-navigable browser; re-platforming it into a flat table is a much bigger, different-shaped change than what was asked, and nothing in the request calls for replacing the existing navigation model.
2. **"Edit" and "rename" are the same action.** There's no separate "edit" concept for an uploaded PDF/DOCX beyond its display name — no in-app content editor exists or was asked for.
3. **Bulk multi-select + floating action bar: cut.** The mockup shows it, but it's real additional complexity (checkboxes, drag-reorder, bulk API calls) that nothing in the request asks for, and no other screen in this app has bulk operations yet. Per-item actions only.
4. **The move-modal's search box: cut.** The tree is fetched lazily per level (see below, matching how `foldersApi.list(parentId)` already works) — there's no backend "search folders by name across the whole tenant" capability to back a real search box, and a decorative non-functional one is worse than omitting it.

## What exists already (verified by reading the code)

- Folder rename/move: `PATCH /folders/:id` and `PATCH /folders/:id/move` already exist and are wired for the *current* folder only, via `window.prompt()` for the destination — exactly the crude UX the design replaces.
- `Document` (`libs/data/src/models/document.schema.ts`): `{timestamps: true}`, so Mongoose already tracks `updatedAt` automatically on every write — it's just not declared as a typed field or exposed in `DocumentSummary`. **"Last update" needs no new tracking, only exposing.**
- `DocumentsPermissionsService.canUploadTo(folderId)` = edit-tier check, already used by upload — the right, existing gate to reuse for rename/move (both source and destination).
- Nothing tracks "last opened" — genuinely new. The closest existing "view" action is `GET /documents/:id/download` (issues a signed URL); this app has no in-app preview, so a download-link issuance is treated as the "open" event.
- No document rename/move endpoint exists at all today — `DocumentsController` has upload/download/delete/list only.

## Design

### Backend

1. **`Document` schema**: declare `updatedAt!: Date` (mirrors the existing `createdAt!: Date` declare-only pattern — Mongoose already populates it), add `@Prop() lastOpenedAt?: Date` (new).
2. **`DocumentsRepository`**: add `renameDocument(id, name)`, `moveDocument(id, folderId)`, `touchLastOpened(id)` — same `updateOne`-then-`findById` shape as `FoldersRepository.renameFolder`/`moveFolder`.
3. **Contracts** (`libs/contracts/src/document-dto.ts`): `UpdateDocumentRequestSchema` (`{name?, folderId?}`, zod `.refine` requiring at least one), extend `DocumentSummary` with `updatedAt: Date` and `lastOpenedAt?: Date`.
4. **`DocumentsController`**:
   - `PATCH /documents/:id` — parse the patch; 404 if the document doesn't resolve in this tenant. Rename requires edit tier on the doc's *current* folder. Move requires edit tier on **both** the current folder (source) and the destination folder (mirrors `FoldersController.move`'s "you must be able to add content where you're putting it" rule) — the destination folder must also actually exist. Audits `document.renamed` / `document.moved`. No permVersion bump needed (unlike a folder move, a document move doesn't change anyone's *folder-tree* permissions — the document's own visibility is entirely a function of whichever folder currently holds it, resolved fresh on every read).
   - `download()`: add a fire-and-forget `touchLastOpened(documentId)` call before returning the signed URL.
   - `toDocumentSummary()`: include `updatedAt`, `lastOpenedAt`.

### Frontend

1. **`apps/web/lib/folders-api.ts`**: extend `DocumentSummary`; add `foldersApi.renameDocument(id, name)`, `foldersApi.moveDocument(id, folderId)`.
2. **New `apps/web/components/folder-picker.tsx`** — a modal shared by folder-move and document-move. Starts at root (`foldersApi.list()`), each row lazily fetches its own children on expand-click (cached per folder id in local state so re-expanding doesn't refetch), single-select with a checkmark, "העבר לכאן" commits by calling a caller-supplied `onMove(destinationFolderId)`. The folder currently being moved (and its own descendants, for a folder move) must not be selectable as its own destination — enforced client-side for UX; the server is the real backstop (a folder can't become its own descendant structurally, and `FoldersRepository.moveFolder` already guards cycles).
3. **`/folders/[id]/page.tsx`**:
   - Replace the current folder's `window.prompt()` move with the new picker modal.
   - Subfolder rows gain hover-revealed rename (inline) and move (opens picker) actions, `stopPropagation`-guarded so they don't trigger the row's own navigation `Link`.
   - Document rows gain rename (inline) and move (opens picker) actions alongside the existing download button.
   - Document table gains three columns: "זמן העלאה" (`createdAt`), "עודכן לאחרונה" (`updatedAt`), "נפתח לאחרונה" (`lastOpenedAt`, rendered as "מעולם לא" — never — when absent).
   - All new actions gated on `canEdit` (same tier the existing create-subfolder/upload controls already require).

## Test plan

- `libs/data`: `documents.repository.spec.ts` — `renameDocument`/`moveDocument`/`touchLastOpened`.
- `apps/api`: `documents.controller.spec.ts` — rename happy path + 404 (missing doc) + 404 (no edit tier on current folder); move happy path + 404 (no edit tier on source) + 404 (no edit tier on destination) + 404 (destination doesn't exist); `download()` stamps `lastOpenedAt`; `listByFolder()`/`toDocumentSummary()` surface the three new fields.
- `apps/api/test/`: extend `folders-permission-matrix.integration.spec.ts` with one real end-to-end case — an editor-tier group member can rename/move a document, a viewer-tier one gets 404 on both.
- Live verification (Playwright MCP against the real dev harness, same pattern as the upload-UI work): rename a document and a subfolder, move a document through the picker modal, confirm the three new columns render with real values (including "מעולם לא" before the first download, then a real timestamp after).

## Task ledger

| # | Task | Done |
|---|---|---|
| 1 | `Document` schema: `updatedAt`, `lastOpenedAt` | [DONE] |
| 2 | `DocumentsRepository`: rename/move/touchLastOpened + tests | [DONE] — 8/8 |
| 3 | Contracts: `UpdateDocumentRequestSchema`, `DocumentSummary` fields | [DONE] |
| 4 | `DocumentsController`: `PATCH /documents/:id`, `download()` last-opened stamp, summary mapping + tests | [DONE] — 44/44 unit |
| 5 | Integration test extension (tier-gated rename/move) | [DONE] — real upload + rename/move through the full guard chain, 14/14 |
| 6 | `folders-api.ts`: new fields + methods | [DONE] |
| 7 | `FolderPicker` modal component | [DONE] |
| 8 | Wire into `/folders/[id]`: subfolder actions, document actions, new columns, replace `window.prompt` move | [DONE] |
| 9 | Live verification | [DONE] — real dev harness + real browser (Playwright MCP): document rename, document move via picker with lazy-loaded nested tree, subfolder rename, all three metadata columns showing correct distinct real timestamps (upload time fixed, last-update bumping on both rename and move, last-opened transitioning from "מעולם לא" to a real value after download) — zero console errors at every step |

Backend fully green: 307/307 apps/api unit, 38/38 integration. Full monorepo pipeline (`build lint test:unit` across all 10 workspace packages) reconfirmed green after this feature: 33/33 tasks successful.
