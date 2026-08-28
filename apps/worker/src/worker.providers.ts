import { Provider } from '@nestjs/common';
import { EmbeddingProvider, FakeEmbeddingProvider, VertexEmbeddingProvider } from '@kms/ai-providers';
import { ClamdScanProvider, FakePassThroughScanProvider, ScanProvider, selectStorageProviderFromEnv, StorageProvider } from '@kms/storage';

/**
 * DI tokens + provider factories, kept in their own file (no `MongooseModule.forRoot(...)` in this
 * module's import graph) — deliberately separate from `worker.module.ts`. A test that needs these
 * tokens but must import `WorkerModule` itself only *after* setting `MONGO_URI` (its `@Module()`
 * decorator reads that env var at class-definition time) would otherwise trip a real Jest footgun:
 * importing these tokens directly `from './worker.module'` at a spec file's top level statically
 * evaluates that decorator early — before `MONGO_URI` is set — permanently baking in the
 * `localhost:27017` fallback for the rest of that module registry. Splitting the tokens out here
 * means a spec file can import them statically without ever touching `worker.module.ts` until the
 * env var is ready.
 */
export const STORAGE_PROVIDER = 'STORAGE_PROVIDER' as const;
export const SCAN_PROVIDER = 'SCAN_PROVIDER' as const;
export const EMBEDDING_PROVIDER = 'EMBEDDING_PROVIDER' as const;

/** Same env-precedence shape as `apps/api/src/documents/documents.providers.ts` — real if credentials/host are set, Fake by default (document-chat-rag plan §3). */
export const scanProviderProvider: Provider = {
  provide: SCAN_PROVIDER,
  useFactory: (): ScanProvider => {
    const host = process.env.CLAMD_HOST;
    if (host) return new ClamdScanProvider({ host, port: Number(process.env.CLAMD_PORT ?? 3310) });
    return new FakePassThroughScanProvider();
  },
};

/** Real if Vertex credentials are configured, Fake otherwise — see the plan's ADR-0008 scope note (the Hebrew benchmark gate hasn't run, so this never silently commits to a provider). */
export const embeddingProviderProvider: Provider = {
  provide: EMBEDDING_PROVIDER,
  useFactory: (): EmbeddingProvider => {
    const projectId = process.env.VERTEX_PROJECT_ID;
    if (projectId) return new VertexEmbeddingProvider({ projectId, region: process.env.VERTEX_REGION ?? 'europe-west4' });
    return new FakeEmbeddingProvider();
  },
};

export const storageProviderProvider: Provider = {
  provide: STORAGE_PROVIDER,
  useFactory: (): Promise<StorageProvider> => selectStorageProviderFromEnv(),
};
