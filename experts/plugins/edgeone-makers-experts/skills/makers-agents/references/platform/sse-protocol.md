# SSE Streaming Protocol Convention

> Covers: unified event types, heartbeat, response headers, reusable `createSSEResponse` helper.

---
## 4. SSE Streaming Protocol Convention (the most important unification)

### Principle
- Every agent endpoint returns `text/event-stream`, with each event formatted as `data: <JSON>\n\n`
- The `type` field has a fixed enumeration (see table below); the frontend dispatches by type
- 5-second `ping` heartbeat; the stream ends with `data: [DONE]\n\n`
- Four required response headers: `Content-Type` + `Cache-Control:no-cache` + `Connection:keep-alive` + `X-Accel-Buffering:no`

### Unified Event Type Table
| type | Fields | Meaning |
|------|--------|---------|
| `ai_response` | `content` | Streaming text delta from the model |
| `tool_call` | `name` | A tool invocation has started |
| `tool_result` | `name`, `content` | Tool result (truncated to ~500 characters) |
| `suggest_actions` | `actions[]` | Suggested actions (clickable options) |
| `file_output` | `base64`, `filename`, `description` | Downloadable file output |
| `usage` | `input_tokens`, `output_tokens`, `total_tokens` | Token statistics |
| `ping` | `ts` | Heartbeat keep-alive |
| `error_message` | `content` | Error message (must not crash the stream) |
| — | — | Send `data: [DONE]\n\n` at the end |

### Reusable SSE Helper (place in `agents/_shared.ts` — multimodal version recommended)
```typescript
export function createLogger(name: string) {
  return {
    log(...args: unknown[]) { console.log(`[${name}][${new Date().toISOString()}]`, ...args); },
    error(...args: unknown[]) { console.error(`[${name}][${new Date().toISOString()}]`, ...args); },
  };
}

export function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function createSSEResponse(
  generator: (signal?: AbortSignal) => AsyncGenerator<string>,
  signal?: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  const readableStream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(sseEvent({ type: 'ping', ts: Date.now() }))); }
        catch { /* stream closed */ }
      }, 5_000);
      try {
        for await (const chunk of generator(signal)) {
          if (signal?.aborted) break;
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (e) {
        const error = e as Error;
        if (error.message?.includes('terminated') && signal?.aborted) {
          // graceful — aborted with content already sent
        } else if (error.name !== 'AbortError' && !signal?.aborted) {
          controller.enqueue(encoder.encode(sseEvent({ type: 'error_message', content: error.message })));
        }
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
    cancel() { /* client disconnected */ },
  });
  return new Response(readableStream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

> **Recommendation**: consolidate this helper set into `_shared.ts` and have every endpoint call `createSSEResponse(gen, signal)`.
> Don't rewrite a `ReadableStream` in every file (the older content-creator code did this inline; align toward the multimodal version).

---
