import { newObjectId } from '@kms/data';
import { chunkProcessor } from './chunk.processor';
import { artifactKey } from './parse.processor';
import { fakeCtx, fakeJob } from './test-helpers';

describe('chunkProcessor', () => {
  const tenantId = newObjectId().toString();
  const documentId = newObjectId().toString();
  const versionId = newObjectId().toString();

  it('reads the parse artifact, chunks it, stores the chunk artifact, and enqueues embed', async () => {
    const ctx = fakeCtx();
    const pages = [{ page: 1, text: 'תוכן קצר לבדיקה' }];
    (ctx.storage.getObject as jest.Mock).mockResolvedValue(Buffer.from(JSON.stringify(pages)));

    await chunkProcessor(fakeJob({ tenantId, documentId, versionId }), ctx);

    expect(ctx.storage.getObject).toHaveBeenCalledWith(artifactKey(versionId, 'parse'));
    const [key, buffer, opts] = (ctx.storage.putObject as jest.Mock).mock.calls[0];
    expect(key).toBe(artifactKey(versionId, 'chunk'));
    expect(opts).toEqual({ contentType: 'application/json' });
    const storedChunks = JSON.parse(buffer.toString('utf8'));
    expect(storedChunks).toEqual([{ seq: 0, page: 1, text: 'תוכן קצר לבדיקה' }]);
    expect(ctx.queues.embed.add).toHaveBeenCalledWith('embed', { tenantId, documentId, versionId });
  });

  it('produces an empty chunk artifact for a page-less/empty parse result (e.g. an image)', async () => {
    const ctx = fakeCtx();
    (ctx.storage.getObject as jest.Mock).mockResolvedValue(Buffer.from(JSON.stringify([])));

    await chunkProcessor(fakeJob({ tenantId, documentId, versionId }), ctx);

    const [, buffer] = (ctx.storage.putObject as jest.Mock).mock.calls[0];
    expect(JSON.parse(buffer.toString('utf8'))).toEqual([]);
    expect(ctx.queues.embed.add).toHaveBeenCalled();
  });
});
