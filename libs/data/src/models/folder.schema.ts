import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

/** PRD §8 — hierarchy depth bound (root = depth 0, up to 9 levels of children). */
export const MAX_FOLDER_DEPTH = 10;

/** ADR-0005 cardinality bound — validated to hold at 4x the 10x-scale assumption. */
export const MAX_FOLDERS_PER_TENANT = 2000;

@Schema({ _id: false })
export class FolderGrant {
  @Prop({ required: true, enum: ['user', 'group'] })
  principalType!: 'user' | 'group';

  @Prop({ required: true, type: Types.ObjectId })
  principalId!: Types.ObjectId;

  @Prop({ required: true, enum: ['read', 'edit'] })
  access!: 'read' | 'edit';
}

/**
 * Nested folder hierarchy (ADR-0002, max depth 10 — PRD §8). `path` is the
 * materialized ancestor array (root-first, self excluded) that ADR-0005's
 * resolution algorithm walks depth-first. Grants + isPublic + hasExplicitGrants
 * implement the inheritance/override/public rules from ADR-0005 — this schema
 * only stores them, `libs/permissions` does the resolution.
 */
@Schema({ collection: 'folders', timestamps: true })
export class Folder {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, default: null })
  parentId!: Types.ObjectId | null;

  @Prop({ required: true, type: [Types.ObjectId], default: [] })
  path!: Types.ObjectId[];

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: [FolderGrant], default: [] })
  grants!: FolderGrant[];

  /** true = grants (even if empty) are authoritative here, not inherited from the parent (ADR-0005 step 2). */
  @Prop({ default: false })
  hasExplicitGrants!: boolean;

  @Prop({ default: false })
  isPublic!: boolean;
}

export type FolderDocument = HydratedDocument<Folder> & { _id: Types.ObjectId };
export const FolderSchema = SchemaFactory.createForClass(Folder);
FolderSchema.index({ tenantId: 1, parentId: 1 });
FolderSchema.plugin(tenantScopeBackstopPlugin);
