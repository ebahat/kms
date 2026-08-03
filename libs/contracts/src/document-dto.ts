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
};
