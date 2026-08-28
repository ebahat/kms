import { FakeChatProvider } from './fake-chat-provider';
import { GroundingChunk } from './chat-provider';

async function collect(gen: AsyncGenerator<{ type: string; text?: string; followUps?: string[] }>) {
  const tokens: string[] = [];
  let followUps: string[] = [];
  for await (const event of gen) {
    if (event.type === 'token' && event.text) tokens.push(event.text);
    if (event.type === 'done') followUps = event.followUps ?? [];
  }
  return { answer: tokens.join(''), followUps };
}

describe('FakeChatProvider', () => {
  it('returns the fixed grounded "not found" answer, with no follow-ups, when there are no grounding chunks (fail-closed contract)', async () => {
    const provider = new FakeChatProvider();
    const { answer, followUps } = await collect(provider.generateAnswer({ question: 'מתי הישיבה הבאה?', groundingChunks: [] }));

    expect(answer).toContain('לא נמצא מידע');
    expect(followUps).toEqual([]);
  });

  it('answers using the retrieved chunks\' text when grounding chunks are present', async () => {
    const provider = new FakeChatProvider();
    const chunks: GroundingChunk[] = [
      { chunkId: 'c1', documentId: 'd1', documentName: 'פרוטוקול.pdf', page: 1, text: 'הישיבה הבאה תתקיים ביום שני.' },
    ];

    const { answer } = await collect(provider.generateAnswer({ question: 'מתי הישיבה הבאה?', groundingChunks: chunks }));

    expect(answer).toContain('הישיבה הבאה תתקיים ביום שני');
    expect(answer).not.toContain('לא נמצא מידע');
  });

  it('derives follow-ups mechanically from distinct grounding-chunk document names, capped at 2', async () => {
    const provider = new FakeChatProvider();
    const chunks: GroundingChunk[] = [
      { chunkId: 'c1', documentId: 'd1', documentName: 'פרוטוקול א.pdf', text: 'תוכן א' },
      { chunkId: 'c2', documentId: 'd2', documentName: 'פרוטוקול ב.pdf', text: 'תוכן ב' },
      { chunkId: 'c3', documentId: 'd3', documentName: 'פרוטוקול ג.pdf', text: 'תוכן ג' },
    ];

    const { followUps } = await collect(provider.generateAnswer({ question: 'שאלה', groundingChunks: chunks }));

    expect(followUps).toHaveLength(2);
    expect(followUps[0]).toContain('פרוטוקול א.pdf');
    expect(followUps[1]).toContain('פרוטוקול ב.pdf');
  });

  it('streams the answer as multiple token events, not one single event', async () => {
    const provider = new FakeChatProvider();
    const chunks: GroundingChunk[] = [{ chunkId: 'c1', documentId: 'd1', documentName: 'x.pdf', text: 'זהו טקסט עם כמה מילים בתוכו' }];

    const events: { type: string }[] = [];
    for await (const event of provider.generateAnswer({ question: 'שאלה', groundingChunks: chunks })) {
      events.push(event);
    }

    const tokenEvents = events.filter((e) => e.type === 'token');
    expect(tokenEvents.length).toBeGreaterThan(1);
    expect(events[events.length - 1].type).toBe('done');
  });

  it('never produces a citation-shaped field — citations are the controller\'s job, not the provider\'s', async () => {
    const provider = new FakeChatProvider();
    const chunks: GroundingChunk[] = [{ chunkId: 'c1', documentId: 'd1', documentName: 'x.pdf', text: 'תוכן' }];

    for await (const event of provider.generateAnswer({ question: 'שאלה', groundingChunks: chunks })) {
      expect(event).not.toHaveProperty('citations');
    }
  });
});
