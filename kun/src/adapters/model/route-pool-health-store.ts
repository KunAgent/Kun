import type {
  ModelFailureMetadata,
  ModelRoutePoolConfig,
  ModelRouteTargetConfig
} from '../../contracts/model-route-pool.js'
import { AtomicJsonFile } from '../../extensions/atomic-json.js'
import { circuitCooldownMs } from './failure-reason.js'

export type RouteTargetMetrics = {
  successes: number
  failures: number
  consecutiveFailures: number
  ewmaLatencyMs?: number
  lastError?: string
  lastAttemptAt?: string
}

export type ModelRouteEvent = {
  at: string
  poolId: string
  targetId: string
  providerId: string
  modelId: string
  latencyMs: number
  result: 'started' | 'success' | 'failure' | 'skipped'
  testId?: string
  category?: string
  reason?: string
  message?: string
}

export type RuntimeHealth = RouteTargetMetrics & {
  circuitOpenUntil?: number
  halfOpenAttempts: number
}

export type PersistedRouteHealth = {
  version: 1
  metrics: Record<string, RouteTargetMetrics>
  events: ModelRouteEvent[]
}

const MAX_ROUTE_EVENTS = 200

export class RoutePoolHealthStore {
  private readonly states = new Map<string, RuntimeHealth>()
  private readonly events_: ModelRouteEvent[] = []
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly filePath?: string, private readonly now: () => number = Date.now) {}

  async load(): Promise<void> {
    if (!this.filePath) return
    try {
      const parsed = await this.file().read(emptyPersistedRouteHealth)
      for (const [key, metrics] of Object.entries(parsed.metrics ?? {})) {
        this.states.set(key, { ...metrics, consecutiveFailures: 0, halfOpenAttempts: 0 })
      }
      this.events_.push(...(Array.isArray(parsed.events) ? parsed.events.slice(-MAX_ROUTE_EVENTS) : []))
    } catch {
      // Missing or corrupt health history must never stop the model runtime.
    }
  }

  state(poolId: string, targetId: string): RuntimeHealth {
    const key = healthKey(poolId, targetId)
    const existing = this.states.get(key)
    if (existing) return existing
    const created: RuntimeHealth = { successes: 0, failures: 0, consecutiveFailures: 0, halfOpenAttempts: 0 }
    this.states.set(key, created)
    return created
  }

  available(pool: ModelRoutePoolConfig, target: ModelRouteTargetConfig): boolean {
    const state = this.state(pool.id, target.id)
    if (!state.circuitOpenUntil) return true
    if (state.circuitOpenUntil > this.now()) return false
    return state.halfOpenAttempts < pool.healthPolicy.halfOpenMaxAttempts
  }

  begin(pool: ModelRoutePoolConfig, target: ModelRouteTargetConfig, testId?: string): void {
    const state = this.state(pool.id, target.id)
    if (state.circuitOpenUntil && state.circuitOpenUntil <= this.now()) state.halfOpenAttempts += 1
    state.lastAttemptAt = new Date(this.now()).toISOString()
    if (testId) this.event(pool, target, 0, 'started', undefined, undefined, testId)
  }

  success(pool: ModelRoutePoolConfig, target: ModelRouteTargetConfig, latencyMs: number, testId?: string): void {
    const state = this.state(pool.id, target.id)
    state.successes += 1
    state.consecutiveFailures = 0
    state.halfOpenAttempts = 0
    state.circuitOpenUntil = undefined
    state.ewmaLatencyMs = state.ewmaLatencyMs === undefined ? latencyMs : state.ewmaLatencyMs * 0.7 + latencyMs * 0.3
    state.lastError = undefined
    this.event(pool, target, latencyMs, 'success', undefined, undefined, testId)
  }

  failure(pool: ModelRoutePoolConfig, target: ModelRouteTargetConfig, latencyMs: number, failure: ModelFailureMetadata | undefined, message: string, testId?: string): void {
    const state = this.state(pool.id, target.id)
    state.failures += 1
    state.consecutiveFailures += 1
    state.lastError = message.slice(0, 500)
    state.ewmaLatencyMs = state.ewmaLatencyMs === undefined ? latencyMs : state.ewmaLatencyMs * 0.7 + latencyMs * 0.3
    const cooldown = circuitCooldownMs({
      reason: failure?.reason,
      resetAt: failure?.resetAt,
      retryAfterMs: failure?.retryAfterMs,
      consecutiveFailures: state.consecutiveFailures,
      policy: pool.healthPolicy,
      now: this.now()
    })
    if (cooldown.open) {
      state.circuitOpenUntil = this.now() + cooldown.durationMs
      state.halfOpenAttempts = 0
    }
    this.event(pool, target, latencyMs, 'failure', failure?.category, message, testId, failure?.reason)
  }

  snapshot(poolId?: string): { metrics: Record<string, RouteTargetMetrics>; events: ModelRouteEvent[] } {
    const metrics: Record<string, RouteTargetMetrics> = {}
    for (const [key, state] of this.states) {
      if (poolId && !key.startsWith(`${poolId}:`)) continue
      const { circuitOpenUntil: _open, halfOpenAttempts: _half, ...persisted } = state
      metrics[key] = persisted
    }
    return { metrics, events: this.events_.filter((event) => !poolId || event.poolId === poolId) }
  }

  prune(pools: readonly ModelRoutePoolConfig[]): void {
    const valid = new Set(pools.flatMap((pool) => pool.targets.map((target) => healthKey(pool.id, target.id))))
    for (const key of this.states.keys()) if (!valid.has(key)) this.states.delete(key)
    this.persist()
  }

  flush(): Promise<void> {
    return this.writeChain
  }

  private event(pool: ModelRoutePoolConfig, target: ModelRouteTargetConfig, latencyMs: number, result: ModelRouteEvent['result'], category?: string, message?: string, testId?: string, reason?: string): void {
    this.events_.push({
      at: new Date(this.now()).toISOString(),
      poolId: pool.id,
      targetId: target.id,
      providerId: target.providerId,
      modelId: target.modelId,
      latencyMs,
      result,
      ...(testId ? { testId } : {}),
      ...(category ? { category } : {}),
      ...(reason ? { reason } : {}),
      ...(message ? { message: message.slice(0, 500) } : {})
    })
    if (this.events_.length > MAX_ROUTE_EVENTS) this.events_.splice(0, this.events_.length - MAX_ROUTE_EVENTS)
    this.persist()
  }

  private persist(): void {
    if (!this.filePath) return
    const payload: PersistedRouteHealth = { version: 1, ...this.snapshot() }
    this.writeChain = this.writeChain.then(async () => {
      await this.file().update(emptyPersistedRouteHealth, (current) => mergePersistedRouteHealth(current, payload))
    }).catch(() => undefined)
  }

  private file(): AtomicJsonFile<PersistedRouteHealth> {
    return new AtomicJsonFile(this.filePath!, validatePersistedRouteHealth)
  }
}

function emptyPersistedRouteHealth(): PersistedRouteHealth {
  return { version: 1, metrics: {}, events: [] }
}

function validatePersistedRouteHealth(value: unknown): PersistedRouteHealth {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid route health state')
  }
  const record = value as Partial<PersistedRouteHealth>
  if (record.version !== 1 || !record.metrics || typeof record.metrics !== 'object' ||
    !Array.isArray(record.events)) throw new Error('invalid route health state')
  return value as PersistedRouteHealth
}

function mergePersistedRouteHealth(current: PersistedRouteHealth, next: PersistedRouteHealth): PersistedRouteHealth {
  const metrics: Record<string, RouteTargetMetrics> = { ...current.metrics }
  for (const [key, value] of Object.entries(next.metrics)) {
    const prior = metrics[key]
    metrics[key] = prior
      ? {
          ...prior,
          ...value,
          successes: Math.max(prior.successes, value.successes),
          failures: Math.max(prior.failures, value.failures),
          consecutiveFailures: value.lastAttemptAt &&
            (!prior.lastAttemptAt || value.lastAttemptAt >= prior.lastAttemptAt)
            ? value.consecutiveFailures
            : prior.consecutiveFailures
        }
      : value
  }
  const events = [...current.events, ...next.events]
    .filter((event, index, all) => all.findIndex((candidate) =>
      JSON.stringify(candidate) === JSON.stringify(event)) === index)
    .sort((left, right) => left.at.localeCompare(right.at))
    .slice(-MAX_ROUTE_EVENTS)
  return { version: 1, metrics, events }
}

export function healthKey(poolId: string, targetId: string): string {
  return `${poolId}:${targetId}`
}
