import { Job } from 'bullmq';
import { toObjectId } from '@kms/data';
import { StageJobData, WorkerContext } from './worker-context';
import { artifactKey } from './parse.processor';
import { EmbeddedChunk } from './embed.processor';

/**
 * ADR-0003's `index` stage — writes the real `chunks` collection rows.
 * Purge-then-insert (ADR-0002): a re-indexed version fully replaces the
 * prior version's chunks for the same document, never accumulates.
 * `folderId` is read fresh from the Document here (not carried through the
 * job payload) — deliberately, since it must reflect the document's
 * *current* folder for retrieval scoping to stay correct even if the
 * document moved while the pipeline was running.
 */
export async function indexProcessor(job: Job<StageJobData>, ctx: WorkerContext): Promise<void> {
  const { documentId, versionId } = job.data;
  const doc = await ctx.documents.findById(toObjectId(documentId));
  if (!doc) return; // document was deleted before the job ran

  const raw = await ctx.storage.getObject(artifactKey(versionId, 'embed'));
  const embedded: EmbeddedChunk[] = JSON.parse(raw.toString('utf8'));

  await ctx.chunks.deleteManyByDocument(toObjectId(documentId));
  if (embedded.length > 0) {
    await ctx.chunks.insertMany(
      embedded.map((c) => ({
        folderId: doc.folderId,
        documentId: toObjectId(documentId),
        versionId: toObjectId(versionId),
        seq: c.seq,
        page: c.page,
        text: c.text,
        embedding: c.embedding,
        embeddingModel: c.embeddingModel,
        lang: c.lang,
      })),
    );
  }

  await ctx.documents.setStatus(toObjectId(documentId), 'indexed');
  await ctx.auditEvents.record({
    action: 'document.indexed',
    targetId: toObjectId(documentId),
    metadata: { versionId, chunkCount: embedded.length },
  });
}
