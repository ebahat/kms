import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

/** PRD §8 — status model for the async ingestion pipeline (queued now; parse/chunk/embed/index land in Phase 3). */
export type DocumentStatus = 'queued' | 'processing' | 'indexed' | 'failed';

/**
 * Current-state document metadata (ADR-0002). `name` is a display string
 * only — never used to construct a storage path (sec §4.4 path-traversal
 * guard); the bytes for each version live under DocumentVersion.storageKey,
 * a server-generated key (ADR-0006).
 */
@Schema({ collection: 'documents', timestamps: true })
export class Document {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  folderId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, enum: ['queued', 'processing', 'indexed', 'failed'], default: 'queued' })
  status!: DocumentStatus;

  @Prop({ required: true, type: Types.ObjectId })
  latestVersionId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  createdBy!: Types.ObjectId;

  /** Populated by `timestamps: true` below, not a real `@Prop` path — declared here purely so callers get a typed field. */
  createdAt!: Date;

  /** Also populated by `timestamps: true` — bumped by Mongoose on every write (rename, move, setLatestVersion), so "last update" needs no new tracking, only exposing. */
  updatedAt!: Date;

  /** Stamped on each signed-download-URL issuance (the closest thing this app has to "viewing" a file — no in-app preview exists). Absent until the first download. */
  @Prop()
  lastOpenedAt?: Date;
}

export type DocumentDocument = HydratedDocument<Document> & { _id: Types.ObjectId };
export const DocumentSchema = SchemaFactory.createForClass(Document);
DocumentSchema.index({ tenantId: 1, folderId: 1 });
DocumentSchema.index({ tenantId: 1, status: 1 });
DocumentSchema.plugin(tenantScopeBackstopPlugin);
