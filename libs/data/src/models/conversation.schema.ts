import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

/**
 * Chat conversation metadata (PRD §10, ADR-0002). Owner-scoped, not merely
 * tenant-scoped — the confidentiality boundary is the USER
 * (`OwnerScopedRepository`'s own doc comment already names this collection
 * as an intended consumer), so a tenant admin has no code path to another
 * user's chat history (sec §3.5).
 */
@Schema({ collection: 'conversations', timestamps: true })
export class Conversation {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  ownerUserId!: Types.ObjectId;

  /** Auto-titling from the first message is a deliberate scope cut this pass — fixed placeholder, user-renaming is a follow-up. */
  @Prop({ required: true, trim: true, default: 'שיחה חדשה' })
  title!: string;

  /** Populated by `timestamps: true` — bumped on every new message, drives conversation-list ordering. */
  createdAt!: Date;
  updatedAt!: Date;
}

export type ConversationDocument = HydratedDocument<Conversation> & { _id: Types.ObjectId };
export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index({ tenantId: 1, ownerUserId: 1, updatedAt: -1 });
ConversationSchema.plugin(tenantScopeBackstopPlugin);
