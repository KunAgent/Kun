import type { ModelStreamChunk } from '../../ports/model-client.js'
import { GATEWAY_SESSION_HEADER, gatewaySessionId, type GatewayUsageRecorder } from '../../services/gateway-usage-service.js'
import type { GatewayAuth } from './model-gateway-core.js'
import type { ServerRuntime } from './server-runtime.js'
import { gatewayCallerAgent, gatewaySessionHint } from './gateway-caller-agent.js'

export type { GatewayUsageRecorder } from '../../services/gateway-usage-service.js'

export class GatewayUsageError extends Error {
  constructor(readonly status: 400 | 503, message: string) {
    super(message)
    this.name = 'GatewayUsageError'
  }
}

export async function beginGatewayUsage(
  runtime: ServerRuntime,
  auth: GatewayAuth,
  request: Request,
  requestedModelId: string,
  resolved: { model: string; providerId?: string },
  body?: Record<string, unknown>
): Promise<GatewayUsageRecorder | undefined> {
  if (auth.kind !== 'public') return undefined
  // Validate even for embedders without persistence. A header never names a Kun thread.
  const sessionHeader = request.headers.get(GATEWAY_SESSION_HEADER)
  try { gatewaySessionId(auth.client?.clientId ?? 'legacy', sessionHeader) } catch {
    throw new GatewayUsageError(400, `${GATEWAY_SESSION_HEADER} must contain 1-128 letters, digits, dots, underscores or hyphens.`)
  }
  if (!runtime.modelGateway?.usage || !auth.client) return undefined
  try {
    const agent = gatewayCallerAgent(request)
    // Without Kun's own session header, group by the agent's session id when it reveals one.
    const session = sessionHeader ?? gatewaySessionHint(request, body) ?? null
    return await runtime.modelGateway.usage.begin({ client: auth.client, sessionHeader: session, requestedModelId, resolved, ...(agent ? { agent } : {}) })
  } catch {
    throw new GatewayUsageError(503, 'Gateway usage storage is unavailable.')
  }
}

/**
 * Explicit iterator closure persists cancellation without waiting for a provider
 * that ignores abort or iterator.return(). No text or tool payload is retained.
 */
export type GatewayUsageStream = AsyncIterable<ModelStreamChunk> & {
  /** Wire serializers settle success only after validating their final payload. */
  finish(outcome: 'completed' | 'failed' | 'cancelled'): Promise<void>
}

export function wrapGatewayUsage(
  chunks: AsyncIterable<ModelStreamChunk>,
  recorder: GatewayUsageRecorder | undefined,
  options: { timedOut?: () => boolean; cancelled?: () => boolean } = {}
): GatewayUsageStream {
  let settlement: Promise<void> | undefined
  const finish: GatewayUsageStream['finish'] = (outcome) => {
    const settledOutcome = outcome === 'failed' && options.cancelled?.() && !options.timedOut?.() ? 'cancelled' : outcome
    settlement ??= Promise.resolve().then(() => recorder?.finish(settledOutcome)).catch(() => {
      throw new GatewayUsageError(503, 'Gateway usage storage is unavailable.')
    })
    return settlement
  }
  return {
    finish,
    [Symbol.asyncIterator]() {
      const source = chunks[Symbol.asyncIterator]()
      const closed = new AbortController()
      let terminal = false
      let sourceClosed = false
      const stopSource = () => {
        if (sourceClosed) return
        sourceClosed = true
        closed.abort(new Error('gateway stream closed'))
        try { void source.return?.().catch(() => undefined) } catch { /* Best-effort provider cleanup. */ }
      }
      return {
        async next(): Promise<IteratorResult<ModelStreamChunk>> {
          if (terminal) return { done: true, value: undefined }
          try {
            const result = await nextOrClosed(source, closed.signal)
            if (terminal) return { done: true, value: undefined }
            if (result.done) {
              terminal = true
              // A missing protocol terminal is incomplete, even after a usage chunk.
              await finish('failed')
              return result
            }
            recorder?.observe(result.value)
            if (result.value.kind === 'completed' || result.value.kind === 'error') {
              terminal = true
              // Successful upstream completion can still fail protocol serialization.
              if (result.value.kind === 'error' || result.value.stopReason === 'error') await finish('failed')
              stopSource()
            }
            return result
          } catch (error) {
            if (!terminal) {
              terminal = true
              await finish('failed')
              stopSource()
              throw error
            }
            // return() interrupted an in-flight next().
            if (closed.signal.aborted) return { done: true, value: undefined }
            throw error
          }
        },
        async return(): Promise<IteratorResult<ModelStreamChunk>> {
          terminal = true
          stopSource()
          await finish(options.timedOut?.() ? 'failed' : 'cancelled')
          return { done: true, value: undefined }
        },
        async throw(error?: unknown): Promise<IteratorResult<ModelStreamChunk>> {
          terminal = true
          stopSource()
          await finish('failed')
          throw error
        }
      }
    }
  }
}

function nextOrClosed(
  source: AsyncIterator<ModelStreamChunk>,
  signal: AbortSignal
): Promise<IteratorResult<ModelStreamChunk>> {
  if (signal.aborted) return Promise.resolve({ done: true, value: undefined })
  return new Promise((resolve, reject) => {
    const onClose = () => { cleanup(); resolve({ done: true, value: undefined }) }
    const cleanup = () => signal.removeEventListener('abort', onClose)
    signal.addEventListener('abort', onClose, { once: true })
    Promise.resolve().then(() => signal.aborted ? { done: true as const, value: undefined } : source.next()).then(
      (result) => { cleanup(); resolve(result) },
      (error) => { cleanup(); reject(error) }
    )
  })
}
