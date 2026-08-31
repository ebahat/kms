import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

export type FavoriteTargetType = 'document' | 'folder';

/**
 * Per-user bookmarks (product-gaps batch, 2026-08-29 item 7). Owner-scoped, not merely
 * tenant-scoped — a favorites list is private to the user who made it, the same confidentiality
 * boundary `OwnerScopedRepository`'s own doc comment already names for conversations/messages.
 */
@Schema({ collection: 'favorites', timestamps: true })
export class Favorite {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  ownerUserId!: Types.ObjectId;

  @Prop({ required: true, enum: ['document', 'folder'] })
  targetType!: FavoriteTargetType;

  @Prop({ required: true, type: Types.ObjectId })
  targetId!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export type FavoriteDocument = HydratedDocument<Favorite> & { _id: Types.ObjectId };
export const FavoriteSchema = SchemaFactory.createForClass(Favorite);
// One favorite per (owner, target) — re-favoriting the same item is idempotent at the controller
// layer (returns the existing row instead of erroring); this index is the data-integrity backstop.
FavoriteSchema.index({ tenantId: 1, ownerUserId: 1, targetType: 1, targetId: 1 }, { unique: true });
FavoriteSchema.plugin(tenantScopeBackstopPlugin);
