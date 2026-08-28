import { Job } from 'bullmq';
import { chunkPages, PageText } from '@kms/parsing';
import { StageJobData, WorkerContext } from './worker-context';
import { artifactKey } from './parse.processor';

/** ADR-0003's `chunk` stage — deterministic paragraph-first splitting (document-chat-rag plan §4). */
export async function chunkProcessor(job: Job<StageJobData>, ctx: WorkerContext): Promise<void> {
  const { versionId } = job.data;
  const raw = await ctx.storage.getObject(artifactKey(versionId, 'parse'));
  const pages: PageText[] = JSON.parse(raw.toString('utf8'));

  const textChunks = chunkPages(pages);

  await ctx.storage.putObject(artifactKey(versionId, 'chunk'), Buffer.from(JSON.stringify(textChunks)), { contentType: 'application/json' });
  await ctx.queues.embed.add('embed', job.data);
}
