import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

/**
 * Output of a purge run for one RecycleBinEntry (sec §7.3 "deletion is
 * verified, not assumed"). `notes` records what this pass did NOT check —
 * right now that's chunks/Atlas-Search hits, since neither collection nor
 * index exists yet (Phase 3/4). Extend the check list there, not here.
 */
@Schema({ collection: 'deletionVerifications', timestamps: { createdAt: 'checkedAt', updatedAt: false } })
export class DeletionVerification {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  recycleBinEntryId!: Types.ObjectId;

  @Prop({ required: true, type: [String] })
  objectKeysChecked!: string[];

  /** Non-empty means the purge left orphaned bytes — passed must be false. */
  @Prop({ required: true, type: [String] })
  objectKeysStillPresent!: string[];

  @Prop({ required: true })
  passed!: boolean;

  @Prop({ type: [String], default: [] })
  notes!: string[];
}

export type DeletionVerificationDocument = HydratedDocument<DeletionVerification> & { _id: Types.ObjectId };
export const DeletionVerificationSchema = SchemaFactory.createForClass(DeletionVerification);
DeletionVerificationSchema.index({ tenantId: 1, recycleBinEntryId: 1 });
DeletionVerificationSchema.plugin(tenantScopeBackstopPlugin);
