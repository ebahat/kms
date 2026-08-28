import { newObjectId } from '@kms/data';
import { indexProcessor } from './index.processor';
import { artifactKey } from './parse.processor';
import { fakeCtx, fakeJob } from './test-helpers';

describe('indexProcessor', () => {
  const tenantId = newObjectId().toString();
  const documentId = newObjectId().toString();
  const versionId = newObjectId().toString();
  const folderId = newObjectId();

  it('does nothing when the document was deleted before the job ran', async () => {
    const ctx = fakeCtx();
    (ctx.documents.findById as jest.Mock).mockResolvedValue(null);

    await indexProcessor(fakeJob({ tenantId, documentId, versionId }), ctx);

    expect(ctx.chunks.insertMany).not.toHaveBeenCalled();
  });

  it('purges any prior chunks for this document before inserting the new set (ADR-0002 purge-then-insert)', async () => {
    const ctx = fakeCtx();
    (ctx.documents.findById as jest.Mock).mockResolvedValue({ folderId });
    const embedded = [{ seq: 0, page: 1, text: 'x', embedding: [0.1], embeddingModel: 'fake-hashed-768', lang: 'he' }];
    (ctx.storage.getObject as jest.Mock).mockResolvedValue(Buffer.from(JSON.stringify(embedded)));

    await indexProcessor(fakeJob({ tenantId, documentId, versionId }), ctx);

    expect(ctx.chunks.deleteManyByDocument).toHaveBeenCalledWith(expect.anything());
    expect(ctx.chunks.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ folderId, seq: 0, page: 1, text: 'x', embedding: [0.1], embeddingModel: 'fake-hashed-768', lang: 'he' }),
    ]);
    expect(ctx.documents.setStatus).toHaveBeenCalledWith(expect.anything(), 'indexed');
    expect(ctx.auditEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document.indexed', metadata: expect.objectContaining({ chunkCount: 1 }) }),
    );
  });

  it('purges without inserting when the embed artifact is an empty chunk set (still marks indexed)', async () => {
    const ctx = fakeCtx();
    (ctx.documents.findById as jest.Mock).mockResolvedValue({ folderId });
    (ctx.storage.getObject as jest.Mock).mockResolvedValue(Buffer.from(JSON.stringify([])));

    await indexProcessor(fakeJob({ tenantId, documentId, versionId }), ctx);

    expect(ctx.chunks.deleteManyByDocument).toHaveBeenCalled();
    expect(ctx.chunks.insertMany).not.toHaveBeenCalled();
    expect(ctx.documents.setStatus).toHaveBeenCalledWith(expect.anything(), 'indexed');
  });

  it('reads folderId fresh from the document rather than from the job payload (stays correct even if the document moved mid-pipeline)', async () => {
    const ctx = fakeCtx();
    const currentFolderId = newObjectId();
    (ctx.documents.findById as jest.Mock).mockResolvedValue({ folderId: currentFolderId });
    (ctx.storage.getObject as jest.Mock).mockResolvedValue(
      Buffer.from(JSON.stringify([{ seq: 0, text: 'x', embedding: [0.1], embeddingModel: 'm', lang: 'en' }])),
    );

    await indexProcessor(fakeJob({ tenantId, documentId, versionId }), ctx);

    expect(ctx.chunks.insertMany).toHaveBeenCalledWith([expect.objectContaining({ folderId: currentFolderId })]);
  });
});
