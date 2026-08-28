import { Job } from 'bullmq';
import { toObjectId } from '@kms/data';
import { StageJobData, WorkerContext } from './worker-context';

/**
 * ADR-0003's `scan` stage. Real clean/infected control flow, tested against
 * `FakePassThroughScanProvider` (the EICAR test string) in this pass — see
 * the plan's scope cuts for why a real clamd binding isn't exercised here.
 */
export async function scanProcessor(job: Job<StageJobData>, ctx: WorkerContext): Promise<void> {
  const { documentId, versionId } = job.data;
  const version = await ctx.documentVersions.findById(toObjectId(versionId));
  if (!version) return; // version was deleted before the job ran — nothing left to scan

  const bytes = await ctx.storage.getObject(version.storageKey);
  const result = await ctx.scanProvider.scan(bytes);

  if (!result.clean) {
    await ctx.documents.setStatus(toObjectId(documentId), 'failed');
    await ctx.auditEvents.record({
      action: 'document.scan.rejected',
      targetId: toObjectId(documentId),
      metadata: { versionId, signature: result.signature },
    });
    return;
  }

  await ctx.queues.parse.add('parse', job.data);
}
