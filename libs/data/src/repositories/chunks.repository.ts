import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model, Types } from 'mongoose';
import { ScopedRepository } from '../scoped-repository';
import { Chunk, ChunkDocument } from '../models/chunk.schema';

export type NewChunk = {
  folderId: Types.ObjectId;
  documentId: Types.ObjectId;
  versionId: Types.ObjectId;
  seq: number;
  page?: number;
  text: string;
  embedding: number[];
  embeddingModel: string;
  lang: 'he' | 'en' | 'mixed';
};

@Injectable()
export class ChunksRepository extends ScopedRepository<Chunk> {
  constructor(@InjectModel(Chunk.name) model: Model<Chunk>, cls: ClsService) {
    super(model, cls);
  }

  /** Written by the `embed` worker stage once per document version — always the whole set at once, never incrementally. */
  insertMany(chunks: NewChunk[]): Promise<ChunkDocument[]> {
    const scope = this.scope();
    return this.model.insertMany(chunks.map((c) => ({ ...c, ...scope }))) as unknown as Promise<ChunkDocument[]>;
  }

  /** Called before re-indexing a new version (purge-then-insert, ADR-0002) and on document delete. */
  deleteManyByDocument(documentId: Types.ObjectId) {
    return this.model.deleteMany({ documentId, ...this.scope() });
  }

  /**
   * The Fake retrieval path's real Mongo read — tenant+folder scoped, no ANN.
   * Capped at a generous scan limit; ADR-0002's own capacity note treats this
   * as fine at MVP corpus size (comfortably under 2,000 folders/tenant, and
   * this is a chunk-count cap on top of that, not a folder-count one).
   */
  findByScope(permittedFolderIds: Types.ObjectId[], limit = 2000): Promise<ChunkDocument[]> {
    if (permittedFolderIds.length === 0) return Promise.resolve([]);
    return this.model
      .find({ folderId: { $in: permittedFolderIds }, ...this.scope() })
      .limit(limit) as unknown as Promise<ChunkDocument[]>;
  }

  /**
   * Keeps chunks' denormalized `folderId` in sync with a document move — a
   * permission-correctness requirement, not a data-freshness nicety: retrieval
   * scoping filters directly on this field, so a stale value would leak (or
   * wrongly hide) chunks relative to the document's real current folder.
   */
  async updateFolderId(documentId: Types.ObjectId, folderId: Types.ObjectId): Promise<void> {
    await this.model.updateMany({ documentId, ...this.scope() }, { $set: { folderId } });
  }

  /**
   * Real Atlas Vector Search (ADR-0002) — `libs/retrieval`'s `AtlasRetrievalProvider` calls this
   * rather than doing raw Mongo access itself (ADR-0001 confines `.aggregate()` to `libs/data`).
   * Deliberately calls `this.model.aggregate(...)` directly, NOT the inherited
   * `ScopedRepository.aggregate()` helper — that helper always prepends `$match` as the pipeline's
   * first stage, but Atlas requires `$vectorSearch` to BE the first stage. The tenant/folder filter
   * therefore lives inside `$vectorSearch.filter` instead, which `backstop.plugin.ts`'s
   * `isProperlyScopedFirstStage` recognizes as an equally valid scoping proof. Unverified in this
   * sandbox — no live Atlas cluster with the `chunks_vector` index, and `mongodb-memory-server`
   * cannot execute `$vectorSearch` at all (document-chat-rag plan's scope cut).
   */
  vectorSearchScoped(embedding: number[], permittedFolderIds: Types.ObjectId[], limit: number): Promise<(ChunkDocument & { score: number })[]> {
    const scope = this.scope();
    return this.model.aggregate([
      {
        $vectorSearch: {
          index: 'chunks_vector',
          path: 'embedding',
          queryVector: embedding,
          numCandidates: limit * 15,
          limit,
          filter: { tenantId: scope.tenantId, folderId: { $in: permittedFolderIds } },
        },
      },
      { $set: { score: { $meta: 'vectorSearchScore' } } },
    ]) as unknown as Promise<(ChunkDocument & { score: number })[]>;
  }

  /** Real Atlas Search (BM25 + Hebrew dual-analyzer, ADR-0002) — same rationale/unverified status as `vectorSearchScoped`. */
  textSearchScoped(text: string, permittedFolderIds: Types.ObjectId[], limit: number): Promise<(ChunkDocument & { score: number })[]> {
    const scope = this.scope();
    return this.model.aggregate([
      {
        $search: {
          index: 'chunks_text',
          compound: {
            must: [{ text: { query: text, path: 'text' } }],
            filter: [{ equals: { path: 'tenantId', value: scope.tenantId } }, { in: { path: 'folderId', value: permittedFolderIds } }],
          },
        },
      },
      { $set: { score: { $meta: 'searchScore' } } },
      { $limit: limit },
    ]) as unknown as Promise<(ChunkDocument & { score: number })[]>;
  }
}
