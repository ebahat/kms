import { newObjectId } from '@kms/data';
import { MIME_TYPES } from '@kms/storage';
import { parseProcessor, artifactKey } from './parse.processor';
import { fakeCtx, fakeJob } from './test-helpers';

jest.mock('@kms/parsing', () => ({
  parsePdf: jest.fn().mockResolvedValue({ pages: [{ page: 1, text: 'pdf text' }], hasLowTextPages: false }),
  parseDocx: jest.fn().mockResolvedValue({ pages: [{ text: 'docx text' }] }),
}));

describe('parseProcessor', () => {
  const tenantId = newObjectId().toString();
  const documentId = newObjectId().toString();
  const versionId = newObjectId().toString();

  it('does nothing when the version was deleted before the job ran', async () => {
    const ctx = fakeCtx();
    (ctx.documentVersions.findById as jest.Mock).mockResolvedValue(null);

    await parseProcessor(fakeJob({ tenantId, documentId, versionId }), ctx);

    expect(ctx.storage.putObject).not.toHaveBeenCalled();
  });

  it('parses a PDF and stores the extracted pages as the parse artifact, then enqueues chunk', async () => {
    const ctx = fakeCtx();
    (ctx.documentVersions.findById as jest.Mock).mockResolvedValue({ storageKey: 'k', mimeType: MIME_TYPES.pdf });
    (ctx.storage.getObject as jest.Mock).mockResolvedValue(Buffer.from('%PDF-1.4'));

    await parseProcessor(fakeJob({ tenantId, documentId, versionId }), ctx);

    expect(ctx.storage.putObject).toHaveBeenCalledWith(
      artifactKey(versionId, 'parse'),
      Buffer.from(JSON.stringify([{ page: 1, text: 'pdf text' }])),
      { contentType: 'application/json' },
    );
    expect(ctx.queues.chunk.add).toHaveBeenCalledWith('chunk', { tenantId, documentId, versionId });
  });

  it('parses a DOCX with no page concept', async () => {
    const ctx = fakeCtx();
    (ctx.documentVersions.findById as jest.Mock).mockResolvedValue({ storageKey: 'k', mimeType: MIME_TYPES.docx });
    (ctx.storage.getObject as jest.Mock).mockResolvedValue(Buffer.from('PK'));

    await parseProcessor(fakeJob({ tenantId, documentId, versionId }), ctx);

    expect(ctx.storage.putObject).toHaveBeenCalledWith(
      artifactKey(versionId, 'parse'),
      Buffer.from(JSON.stringify([{ text: 'docx text' }])),
      { contentType: 'application/json' },
    );
  });

  it('produces no pages for an image (OCR-only input this pass — 3.6 is cut)', async () => {
    const ctx = fakeCtx();
    (ctx.documentVersions.findById as jest.Mock).mockResolvedValue({ storageKey: 'k', mimeType: MIME_TYPES.jpg });
    (ctx.storage.getObject as jest.Mock).mockResolvedValue(Buffer.from('\xff\xd8\xff'));

    await parseProcessor(fakeJob({ tenantId, documentId, versionId }), ctx);

    expect(ctx.storage.putObject).toHaveBeenCalledWith(artifactKey(versionId, 'parse'), Buffer.from(JSON.stringify([])), { contentType: 'application/json' });
    expect(ctx.queues.chunk.add).toHaveBeenCalled();
  });
});
