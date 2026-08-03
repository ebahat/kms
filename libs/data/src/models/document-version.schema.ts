import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

/**
 * Immutable version record (ADR-0002, PRD §8) — uploading a new version
 * never mutates a prior one; restoring an old version creates a new latest
 * version instead of rewriting history. `originalFilename` is untrusted
 * display-only text (sec §4.4); `mimeType` is always server-detected via
 * magic bytes, never taken from the client's declared Content-Type.
 */
@Schema({ collection: 'documentVersions', timestamps: { createdAt: true, updatedAt: false } })
export class DocumentVersion {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  documentId!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  versionNumber!: number;

  /** Server-generated GCS object key (ADR-0006) — never derived from the filename. */
  @Prop({ required: true })
  storageKey!: string;

  @Prop({ required: true, trim: true })
  originalFilename!: string;

  @Prop({ required: true })
  mimeType!: string;

  @Prop({ required: true, min: 0 })
  sizeBytes!: number;

  @Prop({ required: true })
  contentHashSha256!: string;

  @Prop({ required: true, type: Types.ObjectId })
  uploadedBy!: Types.ObjectId;
}

export type DocumentVersionDocument = HydratedDocument<DocumentVersion> & { _id: Types.ObjectId };
export const DocumentVersionSchema = SchemaFactory.createForClass(DocumentVersion);
DocumentVersionSchema.index({ tenantId: 1, documentId: 1, versionNumber: 1 }, { unique: true });
DocumentVersionSchema.plugin(tenantScopeBackstopPlugin);
