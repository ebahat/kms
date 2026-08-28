import request from 'supertest';
import { ChunksRepository, newObjectId, toObjectId, TenantsRepository } from '@kms/data';
import { FakeEmbeddingProvider } from '@kms/ai-providers';
import { buildTestApp, closeTestApp, TestAppContext } from './support/test-app';
import { seedFolder, mintSessionCookie, withScope, scopeFor } from './support/fixtures';
import { ClsService } from 'nestjs-cls';

/**
 * Real end-to-end chat coverage (document-chat-rag plan, Part 2 Task 7): real folder permissions
 * (including a user with ZERO permitted folders), real `chunks` rows (seeded directly via
 * `ChunksRepository` — the actual ingestion pipeline that would normally produce them is
 * `apps/worker`'s job, covered by its own integration test, Part 1 Task 11; this suite tests
 * retrieval + permission-scoping + the chat controller, not ingestion), a real HTTP round trip
 * through `ChatController` against the real Fake providers (embedding/chat/retrieval — no live
 * credentials set, matching every other integration test in this file).
 */
describe('chat — real permission-scoped retrieval and fail-closed grounding', () => {
  let ctx: TestAppContext;
  const embedder = new FakeEmbeddingProvider();

  beforeAll(async () => {
    ctx = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  /** Reconstructs the full streamed answer and the terminal `done` payload from the raw SSE body — each word arrives as its own `event: token` frame, so a raw substring check on the concatenated body text would miss answers that span a frame boundary. */
  function parseSse(body: string): { answer: string; done: { messageId: string; citations: { documentName: string; page?: number }[]; followUps: string[] } } {
    let answer = '';
    let done: any = null;
    for (const frame of body.split('\n\n').filter(Boolean)) {
      const lines = frame.split('\n');
      const eventLine = lines.find((l) => l.startsWith('event:'));
      const dataLine = lines.find((l) => l.startsWith('data:'));
      if (!eventLine || !dataLine) continue;
      const event = eventLine.slice('event:'.length).trim();
      const data = JSON.parse(dataLine.slice('data:'.length).trim());
      if (event === 'token') answer += data.text;
      if (event === 'done') done = data;
    }
    return { answer, done };
  }

  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
    'base64',
  );

  async function seedTenant(tenantId: ReturnType<typeof newObjectId>) {
    await ctx.app.get(TenantsRepository).create({
      _id: tenantId,
      name: 'Chat Test Tenant',
      edition: 'kb',
      storageQuotaBytes: 1024 * 1024 * 1024,
      featureToggles: [],
    } as any);
  }

  /** Uploads a real (tiny) file into a folder to get a real Document row, then seeds a real Chunk row for it directly — the ingestion pipeline itself is apps/worker's responsibility (Part 1 Task 11), not re-tested here. */
  async function seedDocumentWithChunk(opts: { tenantId: ReturnType<typeof newObjectId>; folderId: ReturnType<typeof newObjectId>; uploaderCookie: string; text: string; documentName: string }) {
    const uploadRes = await request(ctx.app.getHttpServer())
      .post('/documents')
      .set('Cookie', opts.uploaderCookie)
      .field('folderId', opts.folderId.toString())
      .attach('file', TINY_PNG, opts.documentName)
      .expect(201);
    const documentId = toObjectId(uploadRes.body.documentId);

    const [embedding] = await embedder.embed([opts.text]);
    const cls = ctx.app.get(ClsService);
    const chunks = ctx.app.get(ChunksRepository);
    await withScope(cls, scopeFor(opts.tenantId, newObjectId()), () =>
      chunks.insertMany([
        {
          folderId: opts.folderId,
          documentId,
          versionId: newObjectId(),
          seq: 0,
          text: opts.text,
          embedding,
          embeddingModel: embedder.modelName,
          lang: 'he',
        },
      ]),
    );

    return documentId;
  }

  it('a user with read access to the folder gets a grounded, cited answer — a user with no accessible folders gets a fail-closed not-found answer with zero citations, for the exact same question', async () => {
    const tenantId = newObjectId();
    await seedTenant(tenantId);

    const memberId = newObjectId();
    const outsiderId = newObjectId();
    const readableFolder = await seedFolder(ctx.app, {
      tenantId,
      grants: [{ principalType: 'user', principalId: memberId, access: 'manage' }],
    });

    const memberCookie = await mintSessionCookie(ctx.app, { userId: memberId, tenantId, featureToggles: ['llm'] });
    const outsiderCookie = await mintSessionCookie(ctx.app, { userId: outsiderId, tenantId, featureToggles: ['llm'] });

    await seedDocumentWithChunk({
      tenantId,
      folderId: readableFolder._id,
      uploaderCookie: memberCookie,
      text: 'התקציב השנתי אושר בישיבת ההנהלה מיום שני בסך מיליון שקלים',
      documentName: 'protocol.png',
    });

    const question = 'מה אושר בישיבת ההנהלה בנוגע לתקציב השנתי?';

    // Member: real grounded answer with a real citation.
    const memberConvRes = await request(ctx.app.getHttpServer()).post('/chat/conversations').set('Cookie', memberCookie).send({}).expect(201);
    const memberConversationId = memberConvRes.body.id;

    const memberMsgRes = await request(ctx.app.getHttpServer())
      .post(`/chat/conversations/${memberConversationId}/messages`)
      .set('Cookie', memberCookie)
      .send({ text: question })
      .expect(200);

    const memberResult = parseSse(memberMsgRes.text);
    expect(memberResult.answer).toContain('התקציב השנתי אושר');
    expect(memberResult.answer).not.toContain('לא נמצא מידע');
    expect(memberResult.done.citations).toEqual([expect.objectContaining({ documentName: 'protocol.png' })]);

    // Outsider: same question, but they have zero accessible folders — fail-closed, no citations, not-found copy.
    const outsiderConvRes = await request(ctx.app.getHttpServer()).post('/chat/conversations').set('Cookie', outsiderCookie).send({}).expect(201);
    const outsiderConversationId = outsiderConvRes.body.id;

    const outsiderMsgRes = await request(ctx.app.getHttpServer())
      .post(`/chat/conversations/${outsiderConversationId}/messages`)
      .set('Cookie', outsiderCookie)
      .send({ text: question })
      .expect(200);

    const outsiderResult = parseSse(outsiderMsgRes.text);
    expect(outsiderResult.answer).toContain('לא נמצא מידע');
    expect(outsiderResult.done.citations).toEqual([]);
    expect(outsiderResult.answer).not.toContain('התקציב');
  }, 30_000);

  it('lists conversation history and deletes a conversation for real', async () => {
    const tenantId = newObjectId();
    await seedTenant(tenantId);
    const userId = newObjectId();
    const cookie = await mintSessionCookie(ctx.app, { userId, tenantId, featureToggles: ['llm'] });

    const createRes = await request(ctx.app.getHttpServer()).post('/chat/conversations').set('Cookie', cookie).send({}).expect(201);
    const conversationId = createRes.body.id;

    await request(ctx.app.getHttpServer())
      .post(`/chat/conversations/${conversationId}/messages`)
      .set('Cookie', cookie)
      .send({ text: 'שאלה כלשהי' })
      .expect(200);

    const listRes = await request(ctx.app.getHttpServer()).get('/chat/conversations').set('Cookie', cookie).expect(200);
    expect(listRes.body.some((c: { id: string }) => c.id === conversationId)).toBe(true);

    const messagesRes = await request(ctx.app.getHttpServer()).get(`/chat/conversations/${conversationId}/messages`).set('Cookie', cookie).expect(200);
    expect(messagesRes.body).toHaveLength(2); // user + assistant

    await request(ctx.app.getHttpServer()).delete(`/chat/conversations/${conversationId}`).set('Cookie', cookie).expect(200);
    await request(ctx.app.getHttpServer()).get(`/chat/conversations/${conversationId}/messages`).set('Cookie', cookie).expect(404);
  }, 30_000);

  it('module-gated: 404s every chat route when the llm module is not enabled for the tenant (ADR-0012)', async () => {
    const tenantId = newObjectId();
    await seedTenant(tenantId);
    const userId = newObjectId();
    const cookieWithoutLlm = await mintSessionCookie(ctx.app, { userId, tenantId, featureToggles: [] });

    await request(ctx.app.getHttpServer()).post('/chat/conversations').set('Cookie', cookieWithoutLlm).send({}).expect(404);
    await request(ctx.app.getHttpServer()).get('/chat/conversations').set('Cookie', cookieWithoutLlm).expect(404);
  });
});
