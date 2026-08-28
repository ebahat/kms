import { NotFoundException } from '@nestjs/common';
import { newObjectId } from '@kms/data';
import { ChatController } from './chat.controller';
import { ChatRateLimitedError } from './chat-errors';
import * as retrievalModule from '@kms/retrieval';
import * as chatBudgetModule from './chat-budget';

jest.mock('@kms/retrieval', () => ({
  ...jest.requireActual('@kms/retrieval'),
  retrieveScoped: jest.fn(),
}));
jest.mock('./chat-budget', () => ({
  enforceChatLimits: jest.fn(),
}));

const mockedRetrieveScoped = retrievalModule.retrieveScoped as jest.Mock;
const mockedEnforceChatLimits = chatBudgetModule.enforceChatLimits as jest.Mock;

function fakeResponse() {
  return { setHeader: jest.fn(), flushHeaders: jest.fn(), write: jest.fn(), end: jest.fn() } as any;
}

async function* fakeAnswerStream(tokens: string[], followUps: string[] = []) {
  for (const t of tokens) yield { type: 'token' as const, text: t };
  yield { type: 'done' as const, followUps };
}

describe('ChatController', () => {
  const tenantId = newObjectId();
  const userId = newObjectId();

  let cls: any;
  let conversations: any;
  let chatMessages: any;
  let chunks: any;
  let documents: any;
  let permissions: any;
  let auditEvents: any;
  let rateLimiter: any;
  let embeddingProvider: any;
  let chatProvider: any;
  let retrievalProvider: any;
  let controller: ChatController;

  beforeEach(() => {
    jest.clearAllMocks();
    cls = { get: jest.fn().mockReturnValue({ tenantId, userId, role: 'user', edition: 'kb' }) };
    conversations = {
      createConversation: jest.fn(),
      listByOwner: jest.fn(),
      findById: jest.fn(),
      deleteConversation: jest.fn().mockResolvedValue(undefined),
      touchUpdatedAt: jest.fn().mockResolvedValue(undefined),
    };
    chatMessages = {
      createMessage: jest.fn(),
      listByConversation: jest.fn(),
      deleteByConversation: jest.fn().mockResolvedValue(undefined),
    };
    chunks = { findById: jest.fn() };
    documents = { findById: jest.fn() };
    permissions = { permittedReadFolderIds: jest.fn().mockResolvedValue([]), canRead: jest.fn() };
    auditEvents = { record: jest.fn().mockResolvedValue(undefined) };
    rateLimiter = {};
    embeddingProvider = { modelName: 'm', dimensions: 1, embed: jest.fn() };
    chatProvider = { modelName: 'c', generateAnswer: jest.fn() };
    retrievalProvider = { retrieve: jest.fn() };

    mockedRetrieveScoped.mockResolvedValue([]);
    mockedEnforceChatLimits.mockResolvedValue(undefined);

    controller = new ChatController(
      cls,
      conversations,
      chatMessages,
      chunks,
      documents,
      permissions,
      auditEvents,
      rateLimiter,
      embeddingProvider,
      chatProvider,
      retrievalProvider,
    );
  });

  describe('createConversation', () => {
    it('creates a conversation, audits it, and returns its summary', async () => {
      const id = newObjectId();
      const now = new Date();
      conversations.createConversation.mockResolvedValue({ _id: id, title: 'שיחה חדשה', createdAt: now, updatedAt: now });

      const result = await controller.createConversation({});

      expect(result).toEqual({ id: id.toString(), title: 'שיחה חדשה', createdAt: now, updatedAt: now });
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'chat.conversation.created' }));
    });
  });

  describe('listConversations', () => {
    it('maps every conversation to its summary', async () => {
      const now = new Date();
      conversations.listByOwner.mockResolvedValue([{ _id: newObjectId(), title: 'א', createdAt: now, updatedAt: now }]);

      const result = await controller.listConversations();

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('א');
    });
  });

  describe('listMessages', () => {
    it('404s when the conversation does not resolve for this owner', async () => {
      conversations.findById.mockResolvedValue(null);
      await expect(controller.listMessages(newObjectId().toString())).rejects.toThrow(NotFoundException);
    });

    it('returns the mapped message history in order', async () => {
      const conversationId = newObjectId();
      conversations.findById.mockResolvedValue({ _id: conversationId });
      chatMessages.listByConversation.mockResolvedValue([
        { _id: newObjectId(), role: 'user', content: 'שאלה', citations: [], ts: new Date() },
      ]);

      const result = await controller.listMessages(conversationId.toString());

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('שאלה');
    });
  });

  describe('deleteConversation', () => {
    it('404s when the conversation does not resolve for this owner', async () => {
      conversations.findById.mockResolvedValue(null);
      await expect(controller.deleteConversation(newObjectId().toString())).rejects.toThrow(NotFoundException);
    });

    it('deletes messages then the conversation, and audits it', async () => {
      const conversationId = newObjectId();
      conversations.findById.mockResolvedValue({ _id: conversationId });

      const result = await controller.deleteConversation(conversationId.toString());

      expect(chatMessages.deleteByConversation).toHaveBeenCalledWith(conversationId);
      expect(conversations.deleteConversation).toHaveBeenCalledWith(conversationId);
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'chat.conversation.deleted' }));
      expect(result).toEqual({ deleted: true });
    });
  });

  describe('getCitation (permission re-verification at click time)', () => {
    it('404s when the chunk does not exist', async () => {
      chunks.findById.mockResolvedValue(null);
      await expect(controller.getCitation(newObjectId().toString())).rejects.toThrow(NotFoundException);
    });

    it('404s when the caller cannot currently read the chunk\'s folder — even if it was citable when the message was generated', async () => {
      const folderId = newObjectId();
      chunks.findById.mockResolvedValue({ folderId, documentId: newObjectId(), page: 1 });
      permissions.canRead.mockResolvedValue(false);

      await expect(controller.getCitation(newObjectId().toString())).rejects.toThrow(NotFoundException);
    });

    it('returns the document id/name/page when access is currently allowed', async () => {
      const folderId = newObjectId();
      const documentId = newObjectId();
      chunks.findById.mockResolvedValue({ folderId, documentId, page: 3 });
      permissions.canRead.mockResolvedValue(true);
      documents.findById.mockResolvedValue({ name: 'פרוטוקול.pdf' });

      const result = await controller.getCitation(newObjectId().toString());

      expect(result).toEqual({ documentId: documentId.toString(), documentName: 'פרוטוקול.pdf', page: 3 });
    });
  });

  describe('sendMessage (streaming, fail-closed grounding)', () => {
    it('rejects an empty message body via ZodError before touching any repository', async () => {
      const res = fakeResponse();
      await expect(controller.sendMessage(newObjectId().toString(), { text: '' }, res)).rejects.toThrow();
      expect(conversations.findById).not.toHaveBeenCalled();
    });

    it('propagates a rate-limit error before ever looking up the conversation or streaming anything', async () => {
      const res = fakeResponse();
      mockedEnforceChatLimits.mockRejectedValueOnce(new ChatRateLimitedError(3600));

      await expect(controller.sendMessage(newObjectId().toString(), { text: 'שאלה' }, res)).rejects.toThrow(ChatRateLimitedError);
      expect(conversations.findById).not.toHaveBeenCalled();
      expect(res.write).not.toHaveBeenCalled();
    });

    it('404s when the conversation does not resolve for this owner, before any streaming', async () => {
      conversations.findById.mockResolvedValue(null);
      const res = fakeResponse();

      await expect(controller.sendMessage(newObjectId().toString(), { text: 'שאלה' }, res)).rejects.toThrow(NotFoundException);
      expect(res.write).not.toHaveBeenCalled();
    });

    it('streams a grounded not-found answer and saves zero citations when the caller has no permitted folders (fail-closed)', async () => {
      const conversationId = newObjectId();
      conversations.findById.mockResolvedValue({ _id: conversationId });
      permissions.permittedReadFolderIds.mockResolvedValue([]);
      mockedRetrieveScoped.mockResolvedValue([]);
      chatProvider.generateAnswer.mockReturnValue(fakeAnswerStream(['לא ', 'נמצא ', 'מידע']));
      chatMessages.createMessage.mockResolvedValue({ _id: newObjectId() });
      const res = fakeResponse();

      await controller.sendMessage(conversationId.toString(), { text: 'שאלה' }, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(res.write).toHaveBeenCalledWith(expect.stringContaining('event: token'));
      expect(res.write).toHaveBeenCalledWith(expect.stringContaining('"citations":[]'));
      expect(res.end).toHaveBeenCalled();
      const assistantSaveCall = chatMessages.createMessage.mock.calls.find((c: any[]) => c[0].role === 'assistant');
      expect(assistantSaveCall[0].citations).toEqual([]);
    });

    it('grounded case: retrieves scoped chunks, streams tokens, saves the assistant message with citations built from retrieval metadata, bumps the conversation, and audits', async () => {
      const conversationId = newObjectId();
      const folderId = newObjectId().toString();
      const chunkId = newObjectId().toString();
      const documentId = newObjectId().toString();
      conversations.findById.mockResolvedValue({ _id: conversationId });
      permissions.permittedReadFolderIds.mockResolvedValue([folderId]);
      mockedRetrieveScoped.mockResolvedValue([
        { chunkId, documentId, documentName: 'פרוטוקול.pdf', page: 2, text: 'תוכן', score: 0.9 },
      ]);
      chatProvider.generateAnswer.mockReturnValue(fakeAnswerStream(['התשובה ', 'היא ', 'כך'], ['שאלה נוספת?']));
      chatMessages.createMessage.mockResolvedValue({ _id: newObjectId() });
      const res = fakeResponse();

      await controller.sendMessage(conversationId.toString(), { text: 'מה קרה?' }, res);

      expect(chatMessages.createMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId, role: 'user', content: 'מה קרה?' }));
      expect(res.write).toHaveBeenCalledWith(expect.stringContaining('event: done'));
      const doneFrame = res.write.mock.calls.map((c: any[]) => c[0]).find((s: string) => s.includes('event: done'));
      expect(doneFrame).toContain('שאלה נוספת?');
      expect(doneFrame).toContain('פרוטוקול.pdf');

      const assistantSaveCall = chatMessages.createMessage.mock.calls.find((c: any[]) => c[0].role === 'assistant');
      expect(assistantSaveCall[0].content).toBe('התשובה היא כך');
      expect(assistantSaveCall[0].citations).toEqual([expect.objectContaining({ documentName: 'פרוטוקול.pdf', page: 2 })]);

      expect(conversations.touchUpdatedAt).toHaveBeenCalledWith(conversationId);
      expect(auditEvents.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'chat.message.sent' }));
    });
  });
});
