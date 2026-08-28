import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

/**
 * A retrieval-unit slice of one document version (ADR-0002). `folderId` is
 * denormalized here (not joined from Document at query time) because it's
 * the field the retrieval pre-filter (ADR-0005's `permittedRead`) matches
 * against directly, and because Atlas Vector Search filter fields must live
 * on the indexed document itself. A document move MUST update its chunks'
 * `folderId` in the same operation (see `ChunksRepository.updateFolderId`)
 * or retrieval scoping goes stale — a real permission-correctness hazard,
 * not just a data-freshness one.
 */
@Schema({ collection: 'chunks', timestamps: false })
export class Chunk {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  folderId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  documentId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  versionId!: Types.ObjectId;

  /** Order within the version — 0-based, stable, used for citation display order. */
  @Prop({ required: true })
  seq!: number;

  /** 1-based source page number, when the parser can determine one (absent for DOCX). */
  @Prop()
  page?: number;

  @Prop({ required: true })
  text!: string;

  /** Fixed-length float vector — length must match the active `EmbeddingProvider`'s dimensionality (768 for both the Fake and Vertex providers, ADR-0002). */
  @Prop({ required: true, type: [Number] })
  embedding!: number[];

  /** Provenance — which provider/model produced `embedding`, so a future re-embed migration (ADR-0010) can find stale rows. */
  @Prop({ required: true })
  embeddingModel!: string;

  @Prop({ required: true, enum: ['he', 'en', 'mixed'] })
  lang!: 'he' | 'en' | 'mixed';
}

export type ChunkDocument = HydratedDocument<Chunk> & { _id: Types.ObjectId };
export const ChunkSchema = SchemaFactory.createForClass(Chunk);
ChunkSchema.index({ tenantId: 1, documentId: 1 });
ChunkSchema.index({ tenantId: 1, folderId: 1 });
ChunkSchema.plugin(tenantScopeBackstopPlugin);
