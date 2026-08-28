import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

/** PRD §8 — tenant-configurable, 30 days by default. */
export const DEFAULT_RECYCLE_BIN_RETENTION_DAYS = 30;

/**
 * A snapshot of one DocumentVersion at delete time — enough to fully
 * reconstruct it on restore without depending on the original (now-deleted)
 * version row still existing anywhere.
 */
@Schema({ _id: false })
export class RecycledVersionSnapshot {
  @Prop({ required: true, min: 1 })
  versionNumber!: number;

  @Prop({ required: true })
  storageKey!: string;

  @Prop({ required: true })
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

/**
 * A deleted document awaiting purge (PRD §8, ADR-0002/0006). The Document
 * and DocumentVersion rows are removed from their live collections at
 * delete time — this entry is the sole record of the item until it's
 * either restored or purged. `status` starts 'pending'; a purge job (not
 * built yet — phase-2 plan design decision, this item ships the pure
 * verification function only) transitions it to 'purged'.
 */
@Schema({ collection: 'recycleBinEntries', timestamps: { createdAt: 'deletedAt', updatedAt: false } })
export class RecycleBinEntry {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  documentId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  folderId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, type: [RecycledVersionSnapshot] })
  versions!: RecycledVersionSnapshot[];

  @Prop({ required: true, type: Types.ObjectId })
  deletedBy!: Types.ObjectId;

  @Prop({ required: true })
  purgeAfter!: Date;

  @Prop({ required: true, enum: ['pending', 'restored', 'purged'], default: 'pending' })
  status!: 'pending' | 'restored' | 'purged';

  /** Populated by `timestamps: { createdAt: 'deletedAt' }` below, not a real `@Prop` path — optional
   * because ScopedRepository.create()'s `Omit<T, 'tenantId'>` input type would otherwise force
   * createEntry() callers to supply a field Mongoose fills in itself at insert time. */
  deletedAt?: Date;
}

export type RecycleBinEntryDocument = HydratedDocument<RecycleBinEntry> & { _id: Types.ObjectId };
export const RecycleBinEntrySchema = SchemaFactory.createForClass(RecycleBinEntry);
RecycleBinEntrySchema.index({ tenantId: 1, status: 1, purgeAfter: 1 });
RecycleBinEntrySchema.plugin(tenantScopeBackstopPlugin);
