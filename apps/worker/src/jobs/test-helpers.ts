import { WorkerContext } from './worker-context';

export function fakeJob(data: { tenantId: string; documentId: string; versionId: string }) {
  return { data } as any;
}

export function fakeCtx(overrides: Partial<WorkerContext> = {}): WorkerContext {
  return {
    documents: { setStatus: jest.fn().mockResolvedValue(undefined), findById: jest.fn() } as any,
    documentVersions: { findById: jest.fn() } as any,
    chunks: { deleteManyByDocument: jest.fn().mockResolvedValue(undefined), insertMany: jest.fn().mockResolvedValue([]) } as any,
    auditEvents: { record: jest.fn().mockResolvedValue(undefined) } as any,
    storage: { getObject: jest.fn(), putObject: jest.fn().mockResolvedValue(undefined) } as any,
    scanProvider: { scan: jest.fn() } as any,
    embeddingProvider: { modelName: 'fake-hashed-768', dimensions: 768, embed: jest.fn() } as any,
    queues: {
      scan: { add: jest.fn() },
      parse: { add: jest.fn() },
      chunk: { add: jest.fn() },
      embed: { add: jest.fn() },
      index: { add: jest.fn() },
    } as any,
    ...overrides,
  };
}
