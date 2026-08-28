import { GoogleAuth } from 'google-auth-library';
import { EmbeddingProvider } from './embedding-provider';

/** ADR-0008: Vertex's per-request instance batch limit for the embedding model. */
const BATCH_SIZE = 32;

/**
 * Real Vertex AI binding for `text-multilingual-embedding` (ADR-0008),
 * `europe-west*` regional endpoints, Application Default Credentials (same
 * ambient-identity pattern as `GcsStorageProvider`). Not exercised by any
 * test and not selected by default — see `document-chat-rag` plan's scope
 * cuts: this environment has no live Vertex credentials, and the ADR-0008
 * Hebrew benchmark gate that would finalize this provider's adoption hasn't
 * run. Written to the real shape so the seam is correct once both exist.
 */
export class VertexEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = 'text-multilingual-embedding-002';
  readonly dimensions = 768;

  private readonly auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

  constructor(private readonly opts: { projectId: string; region: string }) {}

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      results.push(...(await this.embedBatch(batch)));
    }
    return results;
  }

  private async embedBatch(batch: string[]): Promise<number[][]> {
    const client = await this.auth.getClient();
    const { token } = await client.getAccessToken();
    const url = `https://${this.opts.region}-aiplatform.googleapis.com/v1/projects/${this.opts.projectId}/locations/${this.opts.region}/publishers/google/models/${this.modelName}:predict`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: batch.map((content) => ({ content })) }),
    });
    if (!response.ok) {
      throw new Error(`VertexEmbeddingProvider: predict failed with status ${response.status}`);
    }
    const data = (await response.json()) as { predictions: { embeddings: { values: number[] } }[] };
    return data.predictions.map((p) => p.embeddings.values);
  }
}
