// ChatProvider / EmbeddingProvider / VisionOcrProvider adapters (ADR-0008).
// EmbeddingProvider landed via the document-chat-rag plan (2026-08-28, Part 1 Task 5);
// ChatProvider lands in that same plan's Part 2 Task 1. VisionOcrProvider stays out of
// scope — OCR stages (master plan 3.6) are a deliberate cut for this pass.
export * from './embedding-provider';
export * from './vertex-embedding-provider';
export * from './chat-provider';
export * from './fake-chat-provider';
export * from './vertex-chat-provider';
export * from './claude-chat-provider';
