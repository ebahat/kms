import { Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Post, Res, UseFilters } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Response } from 'express';
import { Edition, Module } from '@kms/contracts';
import {
  ChatMessageSummary,
  Citation,
  ConversationSummary,
  CreateConversationRequestSchema,
  DeleteConversationResponse,
  SendMessageRequestSchema,
} from '@kms/contracts';
import {
  AuditEventsRepository,
  ChatMessageDocument,
  ChatMessagesRepository,
  ChunksRepository,
  ConversationDocument,
  ConversationsRepository,
  DocumentsRepository,
  Scope,
  SCOPE_CLS_KEY,
  toObjectId,
} from '@kms/data';
import { RateLimiter } from '@kms/auth';
import { ChatProvider, EmbeddingProvider } from '@kms/ai-providers';
import { retrieveScoped, RetrievalProvider, RetrievedChunk } from '@kms/retrieval';
import { DocumentsPermissionsService } from '../documents/documents-permissions.service';
import { RATE_LIMITER } from '../auth/auth.providers';
import { CHAT_PROVIDER, EMBEDDING_PROVIDER, RETRIEVAL_PROVIDER } from './chat.providers';
import { enforceChatLimits } from './chat-budget';
import { ChatExceptionFilter } from './chat-exception.filter';

/**
 * PRD §10, ADR-0008. Every mutation is audited, matching this codebase's
 * standing convention. `POST .../messages` is the one route with real
 * pre-conditions (rate limit, budget, request validation) that must all be
 * able to reject with a normal JSON status *before* any SSE streaming
 * starts — see that handler's own comment for why it uses `@Res()` manually
 * rather than `@Sse()`.
 */
@Controller()
@Edition('kb')
@Module('llm')
@UseFilters(ChatExceptionFilter)
export class ChatController {
  constructor(
    private readonly cls: ClsService,
    private readonly conversations: ConversationsRepository,
    private readonly chatMessages: ChatMessagesRepository,
    private readonly chunks: ChunksRepository,
    private readonly documents: DocumentsRepository,
    private readonly permissions: DocumentsPermissionsService,
    private readonly auditEvents: AuditEventsRepository,
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiter,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddingProvider: EmbeddingProvider,
    @Inject(CHAT_PROVIDER) private readonly chatProvider: ChatProvider,
    @Inject(RETRIEVAL_PROVIDER) private readonly retrievalProvider: RetrievalProvider,
  ) {}

  @Post('chat/conversations')
  async createConversation(@Body() body: unknown): Promise<ConversationSummary> {
    CreateConversationRequestSchema.parse(body ?? {});
    const conversation = await this.conversations.createConversation();
    await this.auditEvents.record({ action: 'chat.conversation.created', targetId: conversation._id, metadata: {} });
    return this.toConversationSummary(conversation);
  }

  /** Newest-first — PRD §10's conversation-list ordering. */
  @Get('chat/conversations')
  async listConversations(): Promise<ConversationSummary[]> {
    const list = await this.conversations.listByOwner();
    return list.map((c) => this.toConversationSummary(c));
  }

  /** Loads a thread's history — needed to "resume" a conversation (PRD §10), not something the original 5-endpoint sketch listed but structurally required by it. */
  @Get('chat/conversations/:id/messages')
  async listMessages(@Param('id') id: string): Promise<ChatMessageSummary[]> {
    const conversationId = toObjectId(id);
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation) throw new NotFoundException();

    const messages = await this.chatMessages.listByConversation(conversationId);
    return messages.map((m) => this.toChatMessageSummary(m));
  }

  @Delete('chat/conversations/:id')
  @HttpCode(200)
  async deleteConversation(@Param('id') id: string): Promise<DeleteConversationResponse> {
    const conversationId = toObjectId(id);
    const existing = await this.conversations.findById(conversationId);
    if (!existing) throw new NotFoundException();

    await this.chatMessages.deleteByConversation(conversationId);
    await this.conversations.deleteConversation(conversationId);
    await this.auditEvents.record({ action: 'chat.conversation.deleted', targetId: conversationId, metadata: {} });

    return { deleted: true };
  }

  /**
   * Streams the answer over SSE (`event: token` per chunk, one final `event: done`). Deliberately
   * NOT `@Sse()` — that decorator wires an Observable straight to the response with no chance to
   * reject first, but request validation, the rate limit, the tenant budget, and the conversation's
   * existence must all be checked and able to produce a normal JSON error status BEFORE any
   * streaming begins. `@Res()` gives that manual control; matches how `MulterExceptionFilter`-era
   * controllers in this codebase already prefer explicit control over magic decorators whenever
   * there are real pre-conditions.
   */
  @Post('chat/conversations/:id/messages')
  @HttpCode(200)
  async sendMessage(@Param('id') id: string, @Body() body: unknown, @Res() res: Response): Promise<void> {
    const patch = SendMessageRequestSchema.parse(body);
    const scope = this.currentScope();
    await enforceChatLimits(this.rateLimiter, scope.tenantId.toString(), scope.userId.toString());

    const conversationId = toObjectId(id);
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation) throw new NotFoundException();

    await this.chatMessages.createMessage({ conversationId, role: 'user', content: patch.text });

    const permittedFolderIds = await this.permissions.permittedReadFolderIds();
    const groundingChunks: RetrievedChunk[] = await retrieveScoped(this.embeddingProvider, this.retrievalProvider, permittedFolderIds, patch.text);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let fullAnswer = '';
    let followUps: string[] = [];
    for await (const event of this.chatProvider.generateAnswer({ question: patch.text, groundingChunks })) {
      if (event.type === 'token') {
        fullAnswer += event.text;
        res.write(`event: token\ndata: ${JSON.stringify({ text: event.text })}\n\n`);
      } else {
        followUps = event.followUps;
      }
    }

    const citations: Citation[] = groundingChunks.map((c) => ({ chunkId: c.chunkId, documentId: c.documentId, documentName: c.documentName, page: c.page }));
    const savedMessage = await this.chatMessages.createMessage({
      conversationId,
      role: 'assistant',
      content: fullAnswer,
      citations: citations.map((c) => ({ chunkId: toObjectId(c.chunkId), documentId: toObjectId(c.documentId), documentName: c.documentName, page: c.page })),
    });
    await this.conversations.touchUpdatedAt(conversationId);
    await this.auditEvents.record({
      action: 'chat.message.sent',
      targetId: conversationId,
      metadata: { citationCount: citations.length, grounded: groundingChunks.length > 0 },
    });

    res.write(`event: done\ndata: ${JSON.stringify({ messageId: savedMessage._id.toString(), citations, followUps })}\n\n`);
    res.end();
  }

  /** Re-verifies read permission at click time (PRD §10) — a citation captured in an old message must not leak access if the user's permissions changed since. */
  @Get('chat/citations/:chunkId')
  async getCitation(@Param('chunkId') chunkId: string): Promise<{ documentId: string; documentName: string; page?: number }> {
    const chunk = await this.chunks.findById(toObjectId(chunkId));
    if (!chunk) throw new NotFoundException();

    const canRead = await this.permissions.canRead(chunk.folderId.toString());
    if (!canRead) throw new NotFoundException();

    const doc = await this.documents.findById(chunk.documentId);
    if (!doc) throw new NotFoundException();

    return { documentId: chunk.documentId.toString(), documentName: doc.name, page: chunk.page };
  }

  private toConversationSummary(c: ConversationDocument): ConversationSummary {
    return { id: c._id.toString(), title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt };
  }

  private toChatMessageSummary(m: ChatMessageDocument): ChatMessageSummary {
    return {
      id: m._id.toString(),
      role: m.role,
      content: m.content,
      citations: m.citations.map((c) => ({ chunkId: c.chunkId.toString(), documentId: c.documentId.toString(), documentName: c.documentName, page: c.page })),
      ts: m.ts,
    };
  }

  private currentScope(): Scope {
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope) throw new Error('ChatController: no scope in CLS — SessionAuthGuard should have populated it or rejected the request.');
    return scope;
  }
}
