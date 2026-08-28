import { retrieveScoped } from './scoped-retrieval';

describe('retrieveScoped (fail-closed grounding, sec §5.4)', () => {
  it('makes zero calls — no embedding call, no retrieval call — when permittedFolderIds is empty', async () => {
    const embeddingProvider = { modelName: 'm', dimensions: 1, embed: jest.fn() };
    const retrievalProvider = { retrieve: jest.fn() };

    const result = await retrieveScoped(embeddingProvider, retrievalProvider, [], 'שאלה כלשהי');

    expect(result).toEqual([]);
    expect(embeddingProvider.embed).not.toHaveBeenCalled();
    expect(retrievalProvider.retrieve).not.toHaveBeenCalled();
  });

  it('embeds the question then retrieves scoped to the permitted folders when at least one folder is permitted', async () => {
    const embeddingProvider = { modelName: 'm', dimensions: 3, embed: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]) };
    const retrievalProvider = { retrieve: jest.fn().mockResolvedValue([{ chunkId: 'c1', documentId: 'd1', documentName: 'x', text: 'y', score: 0.9 }]) };

    const result = await retrieveScoped(embeddingProvider, retrievalProvider, ['f1'], 'שאלה', 5);

    expect(embeddingProvider.embed).toHaveBeenCalledWith(['שאלה']);
    expect(retrievalProvider.retrieve).toHaveBeenCalledWith({ text: 'שאלה', embedding: [0.1, 0.2, 0.3] }, ['f1'], 5);
    expect(result).toHaveLength(1);
  });

  it('defaults limit to 8 when not given', async () => {
    const embeddingProvider = { modelName: 'm', dimensions: 1, embed: jest.fn().mockResolvedValue([[0.1]]) };
    const retrievalProvider = { retrieve: jest.fn().mockResolvedValue([]) };

    await retrieveScoped(embeddingProvider, retrievalProvider, ['f1'], 'שאלה');

    expect(retrievalProvider.retrieve).toHaveBeenCalledWith(expect.anything(), ['f1'], 8);
  });
});
