import { z } from 'zod';

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, 'invalid id');

/** The multipart form's non-file field, validated separately from the file bytes themselves (PRD §8, sec §4.4). */
export const UploadDocumentFormSchema = z.object({
  folderId: objectIdString,
});
export type UploadDocumentForm = z.infer<typeof UploadDocumentFormSchema>;

export type UploadDocumentResponse = {
  documentId: string;
  versionId: string;
  versionNumber: number;
  status: 'queued';
};

/** Rename and/or move a document (document-file-actions plan, 2026-08-28). Every field optional (PATCH semantics) but at least one must be present — enforced in the controller, not here, matching UpdateUserRequestSchema's own convention. */
export const UpdateDocumentRequestSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  folderId: objectIdString.optional(),
});
export type UpdateDocumentRequest = z.infer<typeof UpdateDocumentRequestSchema>;

/** ADR-0006: issued per click, never stored, never embedded in a listing. */
export type DownloadDocumentResponse = {
  url: string;
  expiresAt: Date;
};

/** PRD §8 — deletion moves a document to the tenant recycle bin, not a live table row. */
export type DeleteDocumentResponse = {
  recycleBinEntryId: string;
};

export type RestoreDocumentResponse = {
  documentId: string;
};

/** `verified` mirrors the DeletionVerification record's `passed` field (sec §7.3). */
export type PurgeRecycleBinEntryResponse = {
  verified: boolean;
};

export type DocumentSummary = {
  id: string;
  folderId: string;
  name: string;
  status: 'queued' | 'processing' | 'indexed' | 'failed';
  latestVersionId: string;
  latestVersionNumber: number;
  sizeBytes: number;
  createdBy: string;
  createdAt: Date;
  /** Mongoose's automatic `updatedAt` — bumped on rename/move/setLatestVersion. */
  updatedAt: Date;
  /** Stamped on each download-link issuance; absent until the document has been opened at least once. */
  lastOpenedAt?: Date;
};

/** UI spec C4 — pending (not yet restored/purged) entries only; folderName resolves the original
 * location for display (a raw folderId means nothing to an admin deciding whether to restore). A
 * folder deleted after the document was recycled leaves folderName null — the entry itself is
 * still valid and restorable to nowhere in particular, not an error state. */
export type RecycleBinEntrySummary = {
  id: string;
  documentId: string;
  name: string;
  folderId: string;
  folderName: string | null;
  sizeBytes: number;
  deletedAt: Date;
  purgeAfter: Date;
};
