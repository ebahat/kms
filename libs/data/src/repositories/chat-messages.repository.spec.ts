import { Types } from 'mongoose';
import { ChatMessagesRepository } from './chat-messages.repository';
import { SCOPE_CLS_KEY, Scope } from '../scope';

class FakeCls {
  private store = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  set(key: string, value: unknown) {
    this.store.set(key, value);
  }
}

function makeModel() {
  return {
    modelName: 'ChatMessage',
    find: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  };
}

describe('ChatMessagesRepository (owner-scoped — sec §3.5)', () => {
  let cls: FakeCls;
  const tenantId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  beforeEach(() => {
    cls = new FakeCls();
    const scope: Scope = { tenantId, userId, role: 'user', edition: 'kb', featureToggles: [], ownerUserId: userId };
    cls.set(SCOPE_CLS_KEY, scope);
  });

  it('createMessage stamps tenantId+ownerUserId and defaults citations to []', async () => {
    const model = makeModel();
    model.create.mockResolvedValue({ _id: new Types.ObjectId() });
    const conversationId = new Types.ObjectId();
    const repo = new ChatMessagesRepository(model as any, cls as any);

    await repo.createMessage({ conversationId, role: 'user', content: 'מתי הפגישה?' });

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId, role: 'user', content: 'מתי הפגישה?', citations: [], tenantId, ownerUserId: userId }),
    );
  });

  it('createMessage preserves server-constructed citations when given', async () => {
    const model = makeModel();
    model.create.mockResolvedValue({});
    const conversationId = new Types.ObjectId();
    const chunkId = new Types.ObjectId();
    const documentId = new Types.ObjectId();
    const repo = new ChatMessagesRepository(model as any, cls as any);

    await repo.createMessage({
      conversationId,
      role: 'assistant',
      content: 'התשובה נמצאת במסמך המצורף.',
      citations: [{ chunkId, documentId, documentName: 'פרוטוקול.pdf', page: 2 }],
    });

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ citations: [{ chunkId, documentId, documentName: 'פרוטוקול.pdf', page: 2 }] }),
    );
  });

  it('listByConversation queries scoped by tenant+owner+conversation and sorts chronologically', () => {
    const model = makeModel();
    const sortFn = jest.fn().mockResolvedValue([]);
    model.find.mockReturnValue({ sort: sortFn });
    const conversationId = new Types.ObjectId();
    const repo = new ChatMessagesRepository(model as any, cls as any);

    repo.listByConversation(conversationId);

    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ conversationId, tenantId, ownerUserId: userId }));
    expect(sortFn).toHaveBeenCalledWith({ ts: 1 });
  });

  it('deleteByConversation removes every message of a conversation, scoped by tenant+owner', async () => {
    const model = makeModel();
    model.deleteMany.mockResolvedValue({});
    const conversationId = new Types.ObjectId();
    const repo = new ChatMessagesRepository(model as any, cls as any);

    await repo.deleteByConversation(conversationId);

    expect(model.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ conversationId, tenantId, ownerUserId: userId }));
  });
});
