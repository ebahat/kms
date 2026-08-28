/** Minimal SSE frame reader for a fetch Response body — shared by the real Vertex/Claude chat bindings, neither of which pulls in a client SDK for this. Not exercised by any test (same status as the bindings that use it). */
export async function* parseSseJsonStream(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let frameEnd: number;
      while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        const payload = dataLine.slice('data:'.length).trim();
        if (payload === '[DONE]') return;
        try {
          yield JSON.parse(payload);
        } catch {
          // malformed frame — skip rather than abort the whole stream
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
