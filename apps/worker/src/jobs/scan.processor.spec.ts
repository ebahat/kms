import { newObjectId } from '@kms/data';
import { scanProcessor } from './scan.processor';
import { fakeCtx, fakeJob } from './test-helpers';

describe('scanProcessor', () => {
  const tenantId = newObjectId().toString();
  const documentId = newObjectId().toString();
  const versionId = newObjectId().toString();

  it('does nothing when the version was deleted before the job ran', async () => {
    const ctx = fakeCtx();
    (ctx.documentVersions.findById as jest.Mock).mockResolvedValue(null);

    await scanProcessor(fakeJob({ tenantId, documentId, versionId }), ctx);

    expect(ctx.storage.getObject).not.toHaveBeenCalled();
  });

  it('enqueues the parse stage when the scan is clean', async () => {
    const ctx = fakeCtx();
    (ctx.documentVersions.findById as jest.Mock).mockResolvedValue({ storageKey: 'tenants/t/versions/v' });
    (ctx.storage.getObject as jest.Mock).mockResolvedValue(Buffer.from('bytes'));
    (ctx.scanProvider.scan as jest.Mock).mockResolvedValue({ clean: true });

    await scanProcessor(fakeJob({ tenantId, documentId, versionId }), ctx);

    expect(ctx.queues.parse.add).toHaveBeenCalledWith('parse', { tenantId, documentId, versionId });
    expect(ctx.documents.setStatus).not.toHaveBeenCalled();
  });

  it('marks the document failed and audits the rejection when infected, without enqueuing parse', async () => {
    const ctx = fakeCtx();
    (ctx.documentVersions.findById as jest.Mock).mockResolvedValue({ storageKey: 'tenants/t/versions/v' });
    (ctx.storage.getObject as jest.Mock).mockResolvedValue(Buffer.from('bytes'));
    (ctx.scanProvider.scan as jest.Mock).mockResolvedValue({ clean: false, signature: 'Eicar-Test-Signature' });

    await scanProcessor(fakeJob({ tenantId, documentId, versionId }), ctx);

    expect(ctx.documents.setStatus).toHaveBeenCalledWith(expect.anything(), 'failed');
    expect(ctx.auditEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document.scan.rejected', metadata: expect.objectContaining({ signature: 'Eicar-Test-Signature' }) }),
    );
    expect(ctx.queues.parse.add).not.toHaveBeenCalled();
  });
});
