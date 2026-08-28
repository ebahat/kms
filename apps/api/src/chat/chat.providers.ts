import { Provider } from '@nestjs/common';
import { ChunksRepository, DocumentsRepository } from '@kms/data';
import {
  ChatProvider,
  ClaudeChatProvider,
  EmbeddingProvider,
  FakeChatProvider,
  FakeEmbeddingProvider,
  VertexChatProvider,
  VertexEmbeddingProvider,
} from '@kms/ai-providers';
import { AtlasRetrievalProvider, FakeRetrievalProvider, RetrievalProvider } from '@kms/retrieval';

export const EMBEDDING_PROVIDER = 'CHAT_EMBEDDING_PROVIDER' as const;
export const CHAT_PROVIDER = 'CHAT_PROVIDER' as const;
export const RETRIEVAL_PROVIDER = 'RETRIEVAL_PROVIDER' as const;

/** Same precedence shape as `apps/worker/src/worker.providers.ts` — real if credentials are set, Fake by default (no live Vertex credentials in this sandbox, and the ADR-0008 gate hasn't run — see the plan's own scope note). Kept as a separate factory from the worker's rather than shared, since the two apps have independent DI containers and this one has no dependency on `apps/worker` at all (apps never import from other apps in this monorepo). */
export const embeddingProviderProvider: Provider = {
  provide: EMBEDDING_PROVIDER,
  useFactory: (): EmbeddingProvider => {
    const projectId = process.env.VERTEX_PROJECT_ID;
    if (projectId) return new VertexEmbeddingProvider({ projectId, region: process.env.VERTEX_REGION ?? 'europe-west4' });
    return new FakeEmbeddingProvider();
  },
};

/** Vertex (primary) → Claude (ADR-0008 fallback) → Fake (default, this sandbox). */
export const chatProviderProvider: Provider = {
  provide: CHAT_PROVIDER,
  useFactory: (): ChatProvider => {
    const projectId = process.env.VERTEX_PROJECT_ID;
    if (projectId) return new VertexChatProvider({ projectId, region: process.env.VERTEX_REGION ?? 'europe-west4' });
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) return new ClaudeChatProvider(anthropicKey);
    return new FakeChatProvider();
  },
};

/** `ATLAS_VECTOR_SEARCH=true` → real Atlas binding, unset (default) → Fake — same env-gate shape as `documents.providers.ts`'s storage precedence. */
export const retrievalProviderProvider: Provider = {
  provide: RETRIEVAL_PROVIDER,
  useFactory: (chunks: ChunksRepository, documents: DocumentsRepository): RetrievalProvider => {
    if (process.env.ATLAS_VECTOR_SEARCH === 'true') return new AtlasRetrievalProvider(chunks, documents);
    return new FakeRetrievalProvider(chunks, documents);
  },
  inject: [ChunksRepository, DocumentsRepository],
};
