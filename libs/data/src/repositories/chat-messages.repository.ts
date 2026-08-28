import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model, Types } from 'mongoose';
import { OwnerScopedRepository } from '../scoped-repository';
import { ChatMessage, ChatMessageDocument, Citation } from '../models/chat-message.schema';

@Injectable()
export class ChatMessagesRepository extends OwnerScopedRepository<ChatMessage> {
  constructor(@InjectModel(ChatMessage.name) model: Model<ChatMessage>, cls: ClsService) {
    super(model, cls);
  }

  createMessage(msg: {
    conversationId: Types.ObjectId;
    role: 'user' | 'assistant';
    content: string;
    citations?: Citation[];
  }): Promise<ChatMessageDocument> {
    return this.model.create({ ...msg, citations: msg.citations ?? [], ...this.scope() }) as unknown as Promise<ChatMessageDocument>;
  }

  /** Chronological — the order a thread renders in. */
  listByConversation(conversationId: Types.ObjectId): Promise<ChatMessageDocument[]> {
    return this.find({ conversationId }).sort({ ts: 1 }) as unknown as Promise<ChatMessageDocument[]>;
  }

  /** Cascade on conversation delete — messages have no independent lifecycle. */
  deleteByConversation(conversationId: Types.ObjectId) {
    return this.model.deleteMany({ conversationId, ...this.scope() });
  }
}
