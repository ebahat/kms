import { newObjectId } from '@kms/data';
import { embedProcessor } from './embed.processor';
import { artifactKey } from './parse.processor';
import { fakeCtx, fakeJob } from './test-helpers';

describe('embedProcessor', () => {
  const tenantId = newObjectId().toString();
  const documentId = newObjectId().toString();
  const versionId = newObjectId().toString();

  it('embeds each chunk, stamps provenance and language, stores the embed artifact, and enqueues index', async () => {
    const ctx = fakeCtx();
    const textChunks = [{ seq: 0, page: 1, text: 'טקסט בעברית' }];
    (ctx.storage.getObject as jest.Mock).mockResolvedValue(Buffer.from(JSON.stringify(textChunks)));
    (ctx.embeddingProvider.embed as jest.Mock).mockResolvedValue([[0.1, 0.2]]);

    await embedProcessor(fakeJob({ tenantId, documentId, versionId }), ctx);

    expect(ctx.storage.getObject).toHaveBeenCalledWith(artifactKey(versionId, 'chunk'));
    expect(ctx.embeddingProvider.embed).toHaveBeenCalledWith(['טקסט בעברית']);
    const [key, buffer] = (ctx.storage.putObject as jest.Mock).mock.calls[0];
    expect(key).toBe(artifactKey(versionId, 'embed'));
    expect(JSON.parse(buffer.toString('utf8'))).toEqual([
      { seq: 0, page: 1, text: 'טקסט בעברית', embedding: [0.1, 0.2], embeddingModel: 'fake-hashed-768', lang: 'he' },
    ]);
    expect(ctx.queues.index.add).toHaveBeenCalledWith('index', { tenantId, documentId, versionId });
  });

  it('does not call the embedding provider for an empty chunk set', async () => {
    const ctx = fakeCtx();
    (ctx.storage.getObject as jest.Mock).mockResolvedValue(Buffer.from(JSON.stringify([])));

    await embedProcessor(fakeJob({ tenantId, documentId, versionId }), ctx);

    expect(ctx.embeddingProvider.embed).not.toHaveBeenCalled();
    const [, buffer] = (ctx.storage.putObject as jest.Mock).mock.calls[0];
    expect(JSON.parse(buffer.toString('utf8'))).toEqual([]);
  });
});
