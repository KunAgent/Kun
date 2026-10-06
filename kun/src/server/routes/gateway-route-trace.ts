import type { GatewayRouteTrace } from '../../contracts/gateway-route-trace.js'
import type { ModelStreamChunk } from '../../ports/model-client.js'
import { tapGatewayStream } from './gateway-stream-tap.js'

export type { GatewayRouteTrace, GatewayRouteTry } from '../../contracts/gateway-route-trace.js'

/**
 * Live routing trace for gateway sessions (`GET /v1/kun/route`) and the
 * admin recent list.
 *
 * A status bar in an external agent can show which concrete provider/model a
 * routed alias picked, and every fallback it tried, before the first token.
 * Session traces are keyed by the caller-scoped session hash the usage ledger
 * already uses, so one client can never read another client's session. The
 * recent list keeps the last requests of every caller for the admin view.
 */
type SessionTrace = { seq: number; trace: GatewayRouteTrace }

const MAX_SESSIONS = 1_024
const MAX_TRIES = 16
const MAX_WAIT_MS = 60_000
const RECENT = 100
/** Waiter key for the admin recent list; session keys are hashes and never collide with it. */
const RECENT_KEY = '\u0000recent'

export class GatewayRouteTraceStore {
  private readonly sessions = new Map<string, SessionTrace>()
  private readonly recentTraces: GatewayRouteTrace[] = []
  private readonly waiters = new Map<string, Set<() => void>>()
  private seq = 0

  constructor(private readonly now: () => number = Date.now) {}

  begin(sessionKey: string | undefined, input: { requestId: string; asked: string; agent?: string; client?: string; effort?: string }): GatewayRouteTraceWriter {
    const startedAt = this.now()
    const trace: GatewayRouteTrace = { seq: 0, requestId: input.requestId, asked: input.asked,
      ...(input.agent ? { agent: input.agent } : {}), ...(input.client ? { client: input.client } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
      startedAt: new Date(startedAt).toISOString(), tries: [], done: false }
    this.recentTraces.push(trace)
    if (this.recentTraces.length > RECENT) this.recentTraces.splice(0, this.recentTraces.length - RECENT)
    const publish = (): void => {
      this.seq += 1
      trace.seq = this.seq
      if (sessionKey) {
        this.sessions.delete(sessionKey)
        while (this.sessions.size >= MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value!)
        this.sessions.set(sessionKey, { seq: this.seq, trace })
        this.wake(sessionKey)
      }
      this.wake(RECENT_KEY)
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
          if (trace.tries.length < MAX_TRIES) trace.tries.push({ ...chunk.to, decision: 'failover' })
          trace.model = `${chunk.to.providerId}/${chunk.to.modelId}`
          publish()
          return
        }
        if (chunk.route && !sawRoute) {
          sawRoute = true
          trace.model = `${chunk.route.providerId}/${chunk.route.modelId}`
          trace.served = trace.model
          if (chunk.route.ruleId) trace.rule = chunk.route.ruleId
          if (chunk.route.intent) trace.intent = chunk.route.intent
          trace.decision = trace.tries[0]?.decision ?? chunk.route.decision
          if (!trace.tries.length) trace.tries.push({ providerId: chunk.route.providerId, modelId: chunk.route.modelId,
            ...(chunk.route.decision ? { decision: chunk.route.decision } : {}) })
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
        trace.durationMs = Math.max(0, this.now() - startedAt)
        if (status !== 'completed') delete trace.served
        publish()
      }
    }
  }

  private wake(key: string): void {
    for (const resolve of [...this.waiters.get(key) ?? []]) resolve()
  }

  /** The most recent requests of every caller, newest last, that changed after `after`. */
  recent(after = 0): { seq: number; traces: GatewayRouteTrace[] } {
    return { seq: this.seq, traces: this.recentTraces.filter((trace) => trace.seq > after).map((trace) => structuredClone(trace)) }
  }

  /** Resolves once any trace changes past `after`, or after `waitMs` (capped at 60s). */
  async waitRecent(after: number, waitMs: number, signal?: AbortSignal): Promise<{ seq: number; traces: GatewayRouteTrace[] }> {
    if (this.seq > after) return this.recent(after)
    await this.park(RECENT_KEY, waitMs, signal)
    return this.recent(after)
  }

  private async park(key: string, waitMs: number, signal?: AbortSignal): Promise<void> {
    const bounded = Math.max(0, Math.min(MAX_WAIT_MS, waitMs))
    if (!bounded || signal?.aborted) return
    await new Promise<void>((resolve) => {
      let set = this.waiters.get(key)
      if (!set) { set = new Set(); this.waiters.set(key, set) }
      const waiters = set
      const done = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', done)
        waiters.delete(done)
        if (!waiters.size) this.waiters.delete(key)
        resolve()
      }
      const timer = setTimeout(done, bounded)
      timer.unref?.()
      signal?.addEventListener('abort', done, { once: true })
      waiters.add(done)
    })
  }

  latest(sessionKey: string): GatewayRouteTrace | null {
    const trace = this.sessions.get(sessionKey)?.trace
    return trace ? structuredClone(trace) : null
  }

  /** Resolves once the session's trace moves past `after`, or after `waitMs` (capped at 60s). */
  async wait(sessionKey: string, after: number, waitMs: number, signal?: AbortSignal): Promise<GatewayRouteTrace | null> {
    const current = this.sessions.get(sessionKey)
    if (current && current.seq > after) return structuredClone(current.trace)
    await this.park(sessionKey, waitMs, signal)
    return this.latest(sessionKey)
  }
}

export type GatewayRouteTraceWriter = {
  observe(chunk: ModelStreamChunk): void
  finish(status: 'completed' | 'failed' | 'cancelled'): void
}

const STORES = new WeakMap<object, GatewayRouteTraceStore>()

export function gatewayRouteTraceStore(owner: object): GatewayRouteTraceStore {
  let store = STORES.get(owner)
  if (!store) { store = new GatewayRouteTraceStore(); STORES.set(owner, store) }
  return store
}

/** Feeds every chunk to the trace and settles it when the stream ends. */
export function traceGatewayStream(source: AsyncIterable<ModelStreamChunk>, writer: GatewayRouteTraceWriter): AsyncIterable<ModelStreamChunk> {
  return tapGatewayStream(source, (chunk) => writer.observe(chunk), (outcome) => writer.finish(outcome))
}
