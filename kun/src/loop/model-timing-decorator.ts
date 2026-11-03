import type {
  ModelClient,
  ModelRequest,
  ModelStreamChunk
} from '../ports/model-client.js'

/**
 * Chunks that represent actual model output (as opposed to transport
 * bookkeeping such as retries, usage, completion, or error markers). The
 * first such chunk marks the end of time-to-first-token; pure tool-call
 * rounds fall back to their first tool chunk so they still get a TTFT.
 */
function isContentChunk(chunk: ModelStreamChunk): boolean {
  return (
    chunk.kind === 'assistant_text_delta' ||
    chunk.kind === 'assistant_reasoning_delta' ||
    chunk.kind === 'tool_call_delta' ||
    chunk.kind === 'tool_call_complete' ||
    chunk.kind === 'image_generation_complete'
  )
}

/**
 * Wraps a `ModelClient` so every streamed response carries per-request
 * timing on its `usage` chunk:
 *
 * - `requestTtftMs`: request start -> first content chunk (TTFT).
 * - `requestGenerationMs`: first content chunk -> usage chunk (used with
 *   `completionTokens` to derive tokens-per-second).
 *
 * The wrapper never modifies the underlying provider parsing; it only
 * clones the usage snapshot to attach timing. Streams without a usage
 * chunk (or without any content chunk) pass through unchanged.
 *
 * The wrapper must preserve the wrapped client's prototype so callers keep
 * seeing optional capability probes such as `selectsRouteTargetDuringStream`
 * and accessors like `model`. Object spread would drop every prototype
 * member and make route pools freeze their public alias as the acting route
 * ("model route changed after the acting route was frozen").
 */
export function withModelTiming(
  client: ModelClient,
  options: { now?: () => number } = {}
): ModelClient {
  const now = options.now ?? ((): number => performance.now())
  const wrapped = Object.create(Object.getPrototypeOf(client)) as ModelClient
  Object.assign(wrapped, client)
  wrapped.stream = (request: ModelRequest): AsyncIterable<ModelStreamChunk> =>
    timedStream(client.stream(request), now)
  return wrapped
}

type TimingState = { startedAt: number; firstChunkAt: number | null }

/** Attach the request's timing to its usage chunk once content has started. */
function timeChunk(chunk: ModelStreamChunk, state: TimingState, now: () => number): ModelStreamChunk {
  if (state.firstChunkAt === null && isContentChunk(chunk)) {
    state.firstChunkAt = now()
  }
  if (chunk.kind === 'usage' && state.firstChunkAt !== null) {
    const usageAt = now()
    const ttftMs = Math.max(0, Math.round(state.firstChunkAt - state.startedAt))
    const generationMs = Math.max(0, Math.round(usageAt - state.firstChunkAt))
    return {
      ...chunk,
      usage: {
        ...chunk.usage,
        requestTtftMs: ttftMs,
        requestGenerationMs: generationMs
      }
    }
  }
  return chunk
}

async function* timedStream(
  stream: AsyncIterable<ModelStreamChunk>,
  now: () => number
): AsyncIterable<ModelStreamChunk> {
  const state: TimingState = { startedAt: now(), firstChunkAt: null }
  for await (const chunk of stream) {
    yield timeChunk(chunk, state, now)
  }
}

/**
 * Time one model stream that is consumed elsewhere (the local gateway streams a
 * harness's request straight from the pooled client). Unlike `timedStream` this
 * is a plain iterator wrapper: an async generator would queue `return()` behind
 * a pending `next()`, so cancelling a stream that is waiting on the provider
 * would never reach it.
 */
export function timeModelStream(
  stream: AsyncIterable<ModelStreamChunk>,
  now: () => number = () => performance.now()
): AsyncIterable<ModelStreamChunk> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<ModelStreamChunk> {
      const source = stream[Symbol.asyncIterator]()
      const state: TimingState = { startedAt: now(), firstChunkAt: null }
      return {
        async next(): Promise<IteratorResult<ModelStreamChunk>> {
          const result = await source.next()
          return result.done ? result : { done: false, value: timeChunk(result.value, state, now) }
        },
        ...(source.return ? { return: (value?: unknown) => source.return!(value) } : {}),
        ...(source.throw ? { throw: (error?: unknown) => source.throw!(error) } : {})
      }
    }
  }
}
