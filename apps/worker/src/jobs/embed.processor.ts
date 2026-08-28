import { Job } from 'bullmq';
import { TextChunk, detectLang } from '@kms/parsing';
import { StageJobData, WorkerContext } from './worker-context';
import { artifactKey } from './parse.processor';

export type EmbeddedChunk = TextChunk & { embedding: number[]; embeddingModel: string; lang: 'he' | 'en' | 'mixed' };

/** ADR-0003's `embed` stage. Provider is selected by `worker.module.ts` (Fake by default — see the plan's ADR-0008 scope note). */
export async function embedProcessor(job: Job<StageJobData>, ctx: WorkerContext): Promise<void> {
  const { versionId } = job.data;
  const raw = await ctx.storage.getObject(artifactKey(versionId, 'chunk'));
  const textChunks: TextChunk[] = JSON.parse(raw.toString('utf8'));

  const embeddings = textChunks.length > 0 ? await ctx.embeddingProvider.embed(textChunks.map((c) => c.text)) : [];
  const embedded: EmbeddedChunk[] = textChunks.map((c, i) => ({
    ...c,
    embedding: embeddings[i],
    embeddingModel: ctx.embeddingProvider.modelName,
    lang: detectLang(c.text),
  }));

  await ctx.storage.putObject(artifactKey(versionId, 'embed'), Buffer.from(JSON.stringify(embedded)), { contentType: 'application/json' });
  await ctx.queues.index.add('index', job.data);
}
