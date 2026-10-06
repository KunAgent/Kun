import type { ModelStreamChunk } from '../../ports/model-client.js'
import { tapGatewayStream } from './gateway-stream-tap.js'

/**
 * Live routing trace for gateway sessions (`GET /v1/kun/route`).
 *
 * A status bar in an external agent can show which concrete provider/model a
 * routed alias picked, and every fallback it tried, before the first token.
 * Traces are keyed by the caller-scoped session hash the usage ledger already
 * uses, so one client can never read another client's session. Nothing about
 * prompt content is retained.
 */
export type GatewayRouteTry = {
  providerId: string
  modelId: string
  /** Failure reason that made the router move on, when this try failed. */
  fail?: string
}

export type GatewayRouteTrace = {
  seq: number
  requestId: string
  asked: string
  agent?: string
  startedAt: string
  /** The provider/model being tried now, once routing has decided. */
  model?: string
  effort?: string
  tries: GatewayRouteTry[]
  done: boolean
  status?: 'completed' | 'failed' | 'cancelled'
  /** The concrete provider/model that produced the reply. */
  served?: string
  /** Route rule that decided the turn's first member. */
  rule?: string
  firstTokenMs?: number
}

type SessionTrace = { seq: number; trace: GatewayRouteTrace }

const MAX_SESSIONS = 1_024
const MAX_TRIES = 16
const MAX_WAIT_MS = 60_000

export class GatewayRouteTraceStore {
  private readonly sessions = new Map<string, SessionTrace>()
  private readonly waiters = new Map<string, Set<() => void>>()
  private seq = 0

  constructor(private readonly now: () => number = Date.now) {}

  begin(sessionKey: string | undefined, input: { requestId: string; asked: string; agent?: string; effort?: string }): GatewayRouteTraceWriter {
    if (!sessionKey) return NOOP_WRITER
    const startedAt = this.now()
    const trace: GatewayRouteTrace = { seq: 0, requestId: input.requestId, asked: input.asked,
      ...(input.agent ? { agent: input.agent } : {}), ...(input.effort ? { effort: input.effort } : {}),
      startedAt: new Date(startedAt).toISOString(), tries: [], done: false }
    const publish = (): void => {
      this.sessions.delete(sessionKey)
      while (this.sessions.size >= MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value!)
      this.seq += 1
      trace.seq = this.seq
      this.sessions.set(sessionKey, { seq: this.seq, trace })
      for (const resolve of [...this.waiters.get(sessionKey) ?? []]) resolve()
    }
    publish()
    let sawRoute = false
    return {
      observe: (chunk) => {
        if (trace.done) return
        if (chunk.kind === 'route_switching') {
          const previous = trace.tries.at(-1)
          const from = `${chunk.from.providerId}/${chunk.from.modelId}`
          if (previous && `${previous.providerId}/${previous.modelId}` === from) previous.fail = chunk.reason ?? 'unavailable'
          else if (trace.tries.length < MAX_TRIES) trace.tries.push({ ...chunk.from, fail: chunk.reason ?? 'unavailable' })
          if (trace.tries.length < MAX_TRIES) trace.tries.push({ ...chunk.to })
          trace.model = `${chunk.to.providerId}/${chunk.to.modelId}`
          publish()
          return
        }
        if (chunk.route && !sawRoute) {
          sawRoute = true
          trace.model = `${chunk.route.providerId}/${chunk.route.modelId}`
          trace.served = trace.model
          if (chunk.route.ruleId) trace.rule = chunk.route.ruleId
          if (!trace.tries.length) trace.tries.push({ providerId: chunk.route.providerId, modelId: chunk.route.modelId })
          if (chunk.kind === 'assistant_text_delta' || chunk.kind === 'assistant_reasoning_delta' || chunk.kind === 'tool_call_delta') {
            trace.firstTokenMs = Math.max(0, this.now() - startedAt)
          }
          publish()
        }
      },
      finish: (status) => {
        if (trace.done) return
        trace.done = true
        trace.status = status
        if (status !== 'completed') delete trace.served
        publish()
      }
    }
  }

  latest(sessionKey: string): GatewayRouteTrace | null {
    const trace = this.sessions.get(sessionKey)?.trace
    return trace ? structuredClone(trace) : null
  }

  /** Resolves once the session's trace moves past `after`, or after `waitMs` (capped at 60s). */
  async wait(sessionKey: string, after: number, waitMs: number, signal?: AbortSignal): Promise<GatewayRouteTrace | null> {
    const current = this.sessions.get(sessionKey)
    if (current && current.seq > after) return structuredClone(current.trace)
    const bounded = Math.max(0, Math.min(MAX_WAIT_MS, waitMs))
    if (!bounded || signal?.aborted) return this.latest(sessionKey)
    await new Promise<void>((resolve) => {
      let set = this.waiters.get(sessionKey)
      if (!set) { set = new Set(); this.waiters.set(sessionKey, set) }
      const waiters = set
      const done = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', done)
        waiters.delete(done)
        if (!waiters.size) this.waiters.delete(sessionKey)
        resolve()
      }
      const timer = setTimeout(done, bounded)
      timer.unref?.()
      signal?.addEventListener('abort', done, { once: true })
      waiters.add(done)
    })
    return this.latest(sessionKey)
  }
}

export type GatewayRouteTraceWriter = {
  observe(chunk: ModelStreamChunk): void
  finish(status: 'completed' | 'failed' | 'cancelled'): void
}

const NOOP_WRITER: GatewayRouteTraceWriter = { observe: () => undefined, finish: () => undefined }

const STORES = new WeakMap<object, GatewayRouteTraceStore>()

export function gatewayRouteTraceStore(owner: object): GatewayRouteTraceStore {
  let store = STORES.get(owner)
  if (!store) { store = new GatewayRouteTraceStore(); STORES.set(owner, store) }
  return store
}

/** Feeds every chunk to the trace and settles it when the stream ends. */
export function traceGatewayStream(source: AsyncIterable<ModelStreamChunk>, writer: GatewayRouteTraceWriter): AsyncIterable<ModelStreamChunk> {
  if (writer === NOOP_WRITER) return source
  return tapGatewayStream(source, (chunk) => writer.observe(chunk), (outcome) => writer.finish(outcome))
}
