import { EmbeddingProvider } from '@kms/ai-providers';
import { RetrievalProvider, RetrievedChunk } from './retrieval-provider';

const DEFAULT_LIMIT = 8;

/**
 * The one audited entry point (ADR-0002's `buildScopedRetrievalQuery` equivalent) — every chat
 * retrieval call goes through this, never a provider directly. `permittedFolderIds` (from
 * `resolveFolderPermissionsCached`, ADR-0005) comes from the caller; an empty set short-circuits to
 * ZERO calls — no embedding call, no Mongo/Atlas call at all. This is where fail-closed grounding
 * (sec §5.4, a zero-tolerance security property, not just UX) physically lives: a user with no
 * accessible folders gets no document context passed to the model, not "all tenant docs minus
 * permissions."
 */
export async function retrieveScoped(
  embeddingProvider: EmbeddingProvider,
  retrievalProvider: RetrievalProvider,
  permittedFolderIds: string[],
  questionText: string,
  limit: number = DEFAULT_LIMIT,
): Promise<RetrievedChunk[]> {
  if (permittedFolderIds.length === 0) return [];

  const [embedding] = await embeddingProvider.embed([questionText]);
  return retrievalProvider.retrieve({ text: questionText, embedding }, permittedFolderIds, limit);
}
