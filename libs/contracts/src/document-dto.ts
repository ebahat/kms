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
