import { Job } from 'bullmq';
import { toObjectId } from '@kms/data';
import { MIME_TYPES } from '@kms/storage';
import { parseDocx, parsePdf, PageText } from '@kms/parsing';
import { StageJobData, WorkerContext } from './worker-context';

/** ADR-0006's inter-stage handoff layout: `artifacts/{versionId}/{stage}`. */
export function artifactKey(versionId: string, stage: string): string {
  return `artifacts/${versionId}/${stage}`;
}

/**
 * ADR-0003's `parse` stage. Extracts a real text layer for PDF/DOCX; JPG/PNG
 * and text-sparse scanned PDF pages contribute no text this pass — OCR
 * stages (master plan 3.6) are a deliberate cut, not a bug (see the plan's
 * scope cuts).
 */
export async function parseProcessor(job: Job<StageJobData>, ctx: WorkerContext): Promise<void> {
  const { documentId, versionId } = job.data;
  const version = await ctx.documentVersions.findById(toObjectId(versionId));
  if (!version) return;

  const bytes = await ctx.storage.getObject(version.storageKey);

  let pages: PageText[];
  if (version.mimeType === MIME_TYPES.pdf) {
    pages = (await parsePdf(bytes)).pages;
  } else if (version.mimeType === MIME_TYPES.docx) {
    pages = (await parseDocx(bytes)).pages;
  } else {
    // JPG/PNG — OCR-only input, no text layer this pass.
    pages = [];
  }

  await ctx.storage.putObject(artifactKey(versionId, 'parse'), Buffer.from(JSON.stringify(pages)), { contentType: 'application/json' });
  await ctx.queues.chunk.add('chunk', job.data);
}
