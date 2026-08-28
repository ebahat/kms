import { Types } from 'mongoose';
import { ChunksRepository } from './chunks.repository';
import { SCOPE_CLS_KEY, Scope } from '../scope';

class FakeCls {
  private store = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  set(key: string, value: unknown) {
    this.store.set(key, value);
  }
}

function makeModel() {
  return {
    modelName: 'Chunk',
    find: jest.fn(),
    insertMany: jest.fn(),
    deleteMany: jest.fn(),
    updateMany: jest.fn(),
    aggregate: jest.fn(),
  };
}

describe('ChunksRepository', () => {
  let cls: FakeCls;
  const tenantId = new Types.ObjectId();

  beforeEach(() => {
    cls = new FakeCls();
    const scope: Scope = { tenantId, userId: new Types.ObjectId(), role: 'user', edition: 'kb', featureToggles: [] };
    cls.set(SCOPE_CLS_KEY, scope);
  });

  it('insertMany stamps tenantId onto every chunk', async () => {
    const model = makeModel();
    model.insertMany.mockResolvedValue([]);
    const repo = new ChunksRepository(model as any, cls as any);
    const folderId = new Types.ObjectId();
    const documentId = new Types.ObjectId();
    const versionId = new Types.ObjectId();

    await repo.insertMany([
      { folderId, documentId, versionId, seq: 0, text: 'a', embedding: [0.1], embeddingModel: 'fake-768', lang: 'he' },
      { folderId, documentId, versionId, seq: 1, text: 'b', embedding: [0.2], embeddingModel: 'fake-768', lang: 'he' },
    ]);

    expect(model.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ seq: 0, tenantId }),
      expect.objectContaining({ seq: 1, tenantId }),
    ]);
  });

  it('deleteManyByDocument scopes by tenantId and documentId', () => {
    const model = makeModel();
    const documentId = new Types.ObjectId();
    const repo = new ChunksRepository(model as any, cls as any);

    repo.deleteManyByDocument(documentId);

    expect(model.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ documentId, tenantId }));
  });

  it('findByScope returns [] without querying Mongo when permittedFolderIds is empty (fail-closed)', async () => {
    const model = makeModel();
    const repo = new ChunksRepository(model as any, cls as any);

    const result = await repo.findByScope([]);

    expect(result).toEqual([]);
    expect(model.find).not.toHaveBeenCalled();
  });

  it('findByScope queries with an $in filter over the permitted folder ids, scoped by tenant, capped at the limit', async () => {
    const model = makeModel();
    const limitFn = jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]);
    model.find.mockReturnValue({ limit: limitFn });
    const folderId = new Types.ObjectId();
    const repo = new ChunksRepository(model as any, cls as any);

    await repo.findByScope([folderId], 500);

    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ folderId: { $in: [folderId] }, tenantId }));
    expect(limitFn).toHaveBeenCalledWith(500);
  });

  it('updateFolderId re-points every chunk of a document to its new folder, scoped by tenant', async () => {
    const model = makeModel();
    model.updateMany.mockResolvedValue({});
    const documentId = new Types.ObjectId();
    const newFolderId = new Types.ObjectId();
    const repo = new ChunksRepository(model as any, cls as any);

    await repo.updateFolderId(documentId, newFolderId);

    expect(model.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ documentId, tenantId }),
      { $set: { folderId: newFolderId } },
    );
  });

  describe('vectorSearchScoped / textSearchScoped (real Atlas paths, document-chat-rag plan §1 — unverified against a live cluster, but the pipeline shape itself is)', () => {
    it('vectorSearchScoped puts $vectorSearch as the pipeline\'s first stage with the tenant+folder filter embedded inside it, not a preceding $match', async () => {
      const model = makeModel();
      model.aggregate.mockResolvedValue([]);
      const folderId = new Types.ObjectId();
      const embedding = [0.1, 0.2, 0.3];
      const repo = new ChunksRepository(model as any, cls as any);

      await repo.vectorSearchScoped(embedding, [folderId], 8);

      const pipeline = model.aggregate.mock.calls[0][0];
      expect(pipeline[0]).toEqual({
        $vectorSearch: {
          index: 'chunks_vector',
          path: 'embedding',
          queryVector: embedding,
          numCandidates: 120,
          limit: 8,
          filter: { tenantId, folderId: { $in: [folderId] } },
        },
      });
    });

    it('textSearchScoped puts $search as the pipeline\'s first stage with a tenantId equals clause and a folderId in-clause in its compound filter', async () => {
      const model = makeModel();
      model.aggregate.mockResolvedValue([]);
      const folderId = new Types.ObjectId();
      const repo = new ChunksRepository(model as any, cls as any);

      await repo.textSearchScoped('תקציב שנתי', [folderId], 8);

      const pipeline = model.aggregate.mock.calls[0][0];
      expect(pipeline[0]).toEqual({
        $search: {
          index: 'chunks_text',
          compound: {
            must: [{ text: { query: 'תקציב שנתי', path: 'text' } }],
            filter: [{ equals: { path: 'tenantId', value: tenantId } }, { in: { path: 'folderId', value: [folderId] } }],
          },
        },
      });
    });
  });
});
