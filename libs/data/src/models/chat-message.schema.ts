import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

/**
 * A citation is constructed server-side from retrieval metadata ONLY — never
 * parsed out of the model's text output (sec §5.1, ADR-0008's prompt
 * architecture). This shape is what the controller is allowed to build one
 * from; there is no path from raw model text to a Citation.
 */
@Schema({ _id: false })
export class Citation {
  @Prop({ required: true, type: Types.ObjectId })
  chunkId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  documentId!: Types.ObjectId;

  @Prop({ required: true })
  documentName!: string;

  @Prop()
  page?: number;
}
export const CitationSchema = SchemaFactory.createForClass(Citation);

/**
 * One turn of a conversation (PRD §10, ADR-0002). Owner-scoped like
 * `Conversation` — see that schema's doc comment for why.
 */
@Schema({ collection: 'messages', timestamps: { createdAt: 'ts', updatedAt: false } })
export class ChatMessage {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  ownerUserId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  conversationId!: Types.ObjectId;

  @Prop({ required: true, enum: ['user', 'assistant'] })
  role!: 'user' | 'assistant';

  @Prop({ required: true })
  content!: string;

  @Prop({ type: [CitationSchema], default: [] })
  citations!: Citation[];

  /** Populated by `timestamps: { createdAt: 'ts' }` above. */
  ts!: Date;
}

export type ChatMessageDocument = HydratedDocument<ChatMessage> & { _id: Types.ObjectId };
export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);
ChatMessageSchema.index({ tenantId: 1, conversationId: 1, ts: 1 });
ChatMessageSchema.plugin(tenantScopeBackstopPlugin);
