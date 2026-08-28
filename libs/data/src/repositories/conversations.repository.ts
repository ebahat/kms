import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model, Types } from 'mongoose';
import { OwnerScopedRepository } from '../scoped-repository';
import { Conversation, ConversationDocument } from '../models/conversation.schema';

@Injectable()
export class ConversationsRepository extends OwnerScopedRepository<Conversation> {
  constructor(@InjectModel(Conversation.name) model: Model<Conversation>, cls: ClsService) {
    super(model, cls);
  }

  createConversation(): Promise<ConversationDocument> {
    return this.model.create(this.scope()) as unknown as Promise<ConversationDocument>;
  }

  /** Newest-first — the conversation-list ordering PRD §10 expects. */
  listByOwner(): Promise<ConversationDocument[]> {
    return this.find().sort({ updatedAt: -1 }) as unknown as Promise<ConversationDocument[]>;
  }

  async touchUpdatedAt(id: Types.ObjectId): Promise<void> {
    await this.updateOne({ _id: id }, { $set: { updatedAt: new Date() } });
  }

  /** A real hard delete — PRD §10 requires user-deletable history, unlike the append-only audit-log pattern elsewhere in this codebase. */
  deleteConversation(id: Types.ObjectId) {
    return this.deleteOne({ _id: id });
  }
}
