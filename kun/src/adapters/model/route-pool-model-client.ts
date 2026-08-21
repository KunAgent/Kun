import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type {
  ModelFailureMetadata,
  ModelRoutePoolConfig,
  ModelRouteTargetConfig
} from '../../contracts/model-route-pool.js'
import { LOCAL_MODEL_GATEWAY_PROVIDER_ID } from '../../contracts/model-route-pool.js'
import type {
  ModelClient,
  ModelRequest,
  ModelRouteTargetMetadata,
  ModelStreamChunk
} from '../../ports/model-client.js'
import { AtomicJsonFile } from '../../extensions/atomic-json.js'

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
  message?: string
}

type RuntimeHealth = RouteTargetMetrics & {
  circuitOpenUntil?: number
  halfOpenAttempts: number
}

type PersistedHealth = {
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
      const parsed = await this.file().read(emptyPersistedHealth)
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
    if (state.consecutiveFailures >= pool.healthPolicy.failureThreshold) {
      state.circuitOpenUntil = this.now() + Math.max(pool.healthPolicy.cooldownMs, failure?.retryAfterMs ?? 0)
      state.halfOpenAttempts = 0
    }
    this.event(pool, target, latencyMs, 'failure', failure?.category, message, testId)
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

  private event(pool: ModelRoutePoolConfig, target: ModelRouteTargetConfig, latencyMs: number, result: ModelRouteEvent['result'], category?: string, message?: string, testId?: string): void {
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
      ...(message ? { message: message.slice(0, 500) } : {})
    })
    if (this.events_.length > MAX_ROUTE_EVENTS) this.events_.splice(0, this.events_.length - MAX_ROUTE_EVENTS)
    this.persist()
  }

  private persist(): void {
    if (!this.filePath) return
    const payload: PersistedHealth = { version: 1, ...this.snapshot() }
    this.writeChain = this.writeChain.then(async () => {
      await this.file().update(emptyPersistedHealth, (current) => mergePersistedHealth(current, payload))
    }).catch(() => undefined)
  }

  private file(): AtomicJsonFile<PersistedHealth> {
    return new AtomicJsonFile(this.filePath!, validatePersistedHealth)
  }
}

function emptyPersistedHealth(): PersistedHealth {
  return { version: 1, metrics: {}, events: [] }
}

function validatePersistedHealth(value: unknown): PersistedHealth {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid route health state')
  }
  const record = value as Partial<PersistedHealth>
  if (record.version !== 1 || !record.metrics || typeof record.metrics !== 'object' ||
    !Array.isArray(record.events)) throw new Error('invalid route health state')
  return value as PersistedHealth
}

function mergePersistedHealth(current: PersistedHealth, next: PersistedHealth): PersistedHealth {
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

export class RoutePoolModelClient implements ModelClient {
  readonly provider = 'route-pool'
  get model(): string { return this.direct.model }
  private pools = new Map<string, ModelRoutePoolConfig>()
  private configured: ModelRoutePoolConfig[] = []
  private readonly roundRobin = new Map<string, number>()

  constructor(
    private readonly direct: ModelClient,
    pools: readonly ModelRoutePoolConfig[],
    private readonly capabilities: (model: string, providerId?: string) => ModelCapabilityMetadata,
    readonly health: RoutePoolHealthStore = new RoutePoolHealthStore(),
    private readonly now: () => number = Date.now
  ) {
    this.replacePools(pools)
  }

  replacePools(pools: readonly ModelRoutePoolConfig[]): void {
    this.configured = pools.map((pool) => structuredClone(pool))
    this.pools = new Map(pools.filter((pool) => pool.enabled).map((pool) => [pool.modelId.toLowerCase(), structuredClone(pool)]))
    this.roundRobin.clear()
    this.health.prune([...this.pools.values()])
  }

  routePools(): ModelRoutePoolConfig[] {
    return [...this.pools.values()].map((pool) => structuredClone(pool))
  }

  configuredPools(): ModelRoutePoolConfig[] {
    return structuredClone(this.configured)
  }

  selectsRouteTargetDuringStream(
    request: Pick<ModelRequest, 'model' | 'providerId'>
  ): boolean {
    const pool = this.pools.get(request.model.trim().toLowerCase())
    return Boolean(pool && shouldRouteRequest(pool, request))
  }

  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const pool = this.pools.get(request.model.trim().toLowerCase())
    return pool && shouldRouteRequest(pool, request)
      ? this.streamPool(pool, request)
      : this.direct.stream(request)
  }

  private async *streamPool(pool: ModelRoutePoolConfig, request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const eligible = pool.targets.filter((target) => target.enabled && this.health.available(pool, target) && targetSupportsRequest(target, request, this.capabilities))
    if (eligible.length === 0) {
      yield {
        kind: 'error',
        message: `route pool ${pool.modelId} has no healthy target that satisfies this request`,
        code: 'route_no_eligible_target',
        failure: { category: 'capability', failoverAllowed: false, routePoolId: pool.id }
      }
      return
    }
    const ordered = this.orderTargets(pool, eligible)
    const failures: string[] = []
    for (const target of ordered) {
      const started = this.now()
      this.health.begin(pool, target, request.routeTestId)
      const route: ModelRouteTargetMetadata = {
        routePoolId: pool.id,
        targetId: target.id,
        providerId: target.providerId,
        modelId: target.modelId,
        requestedModelId: request.model
      }
      let committed = false
      let failed = false
      const pending: ModelStreamChunk[] = []
      try {
        for await (const chunk of this.direct.stream({
          ...request,
          model: target.modelId,
          providerId: target.providerId
        })) {
          if (chunk.kind === 'error') {
            failed = true
            const latency = Math.max(0, this.now() - started)
            const failure = withRouteFailure(chunk.failure, route)
            this.health.failure(pool, target, latency, failure, chunk.message, request.routeTestId)
            if (!committed && routeFailureAllowed(pool, failure)) {
              // Do not expose a rejected target. The first observable route is
              // therefore the immutable target that owns the response after
              // any pre-content failover.
              pending.length = 0
              failures.push(`${target.providerId}/${target.modelId}: ${chunk.message}`)
              break
            }
            for (const buffered of pending) yield attributeRouteChunk(buffered, route)
            pending.length = 0
            yield attributeRouteChunk({ ...chunk, failure }, route)
            return
          }
          if (!committed && !isContentChunk(chunk)) {
            pending.push(chunk)
            continue
          }
          if (!committed) {
            committed = true
            for (const buffered of pending) yield attributeRouteChunk(buffered, route)
            pending.length = 0
          }
          yield attributeRouteChunk(chunk, route)
        }
      } catch (error) {
        failed = true
        const message = error instanceof Error ? error.message : String(error)
        const failure = withRouteFailure({ category: 'unavailable', failoverAllowed: true }, route)
        this.health.failure(pool, target, Math.max(0, this.now() - started), failure, message, request.routeTestId)
        if (committed) {
          yield { kind: 'error', message, code: 'route_target_error', failure, route }
          return
        }
        failures.push(`${target.providerId}/${target.modelId}: ${message}`)
      }
      if (!failed) {
        if (!committed) {
          // Success requires at least one content commit point (text,
          // reasoning, a complete tool call, or generated output). A stream
          // that ends with only usage/completed markers, or nothing at all,
          // would otherwise persist as a healthy empty answer. Fail the
          // target and fail over instead of fabricating completion.
          const message =
            `route target ${target.providerId}/${target.modelId} completed without any content`
          const failure = withRouteFailure(
            { category: 'unavailable', failoverAllowed: true },
            route
          )
          this.health.failure(
            pool,
            target,
            Math.max(0, this.now() - started),
            failure,
            message,
            request.routeTestId
          )
          failures.push(`${target.providerId}/${target.modelId}: ${message}`)
          continue
        }
        for (const buffered of pending) yield attributeRouteChunk(buffered, route)
        this.health.success(pool, target, Math.max(0, this.now() - started), request.routeTestId)
        return
      }
    }
    yield {
      kind: 'error',
      message: `route pool ${pool.modelId} exhausted ${failures.length} target(s): ${failures.join(' | ').slice(0, 1_500)}`,
      code: 'route_targets_exhausted',
      failure: { category: 'unavailable', failoverAllowed: false, routePoolId: pool.id }
    }
  }

  private orderTargets(pool: ModelRoutePoolConfig, targets: ModelRouteTargetConfig[]): ModelRouteTargetConfig[] {
    if (pool.strategy === 'priority') return [...targets]
    if (pool.strategy === 'least-latency') {
      return [...targets].sort((a, b) => latency(this.health.state(pool.id, a.id)) - latency(this.health.state(pool.id, b.id)))
    }
    if (pool.strategy === 'adaptive') {
      return [...targets].sort((a, b) => adaptiveScore(this.health.state(pool.id, b.id)) - adaptiveScore(this.health.state(pool.id, a.id)))
    }
    const cursor = this.roundRobin.get(pool.id) ?? 0
    this.roundRobin.set(pool.id, cursor + 1)
    if (pool.strategy === 'round-robin') return rotate(targets, cursor % targets.length)
    const wheel = targets.flatMap((target) => Array.from({ length: target.weight }, () => target))
    const first = wheel[cursor % wheel.length]
    return [first, ...targets.filter((target) => target.id !== first.id)]
  }
}

function shouldRouteRequest(
  pool: ModelRoutePoolConfig,
  request: Pick<ModelRequest, 'providerId'>
): boolean {
  const providerId = request.providerId?.trim().toLowerCase()
  if (!providerId) return true
  return providerId === LOCAL_MODEL_GATEWAY_PROVIDER_ID || providerId === `route-pool:${pool.id}`.toLowerCase()
}

function targetSupportsRequest(
  target: ModelRouteTargetConfig,
  request: ModelRequest,
  resolve: (model: string, providerId?: string) => ModelCapabilityMetadata
): boolean {
  const capability = resolve(target.modelId, target.providerId)
  const hasHistoricalImages = Object.values(request.messageAttachments ?? {})
    .some((attachments) => attachments.images.length > 0)
  if (
    ((request.attachments?.length ?? 0) > 0 || hasHistoricalImages) &&
    !capability.inputModalities.includes('image')
  ) return false
  if (request.tools.length > 0 && !capability.supportsToolCalling) return false
  if (request.reasoningEffort && request.reasoningEffort !== 'off' && !capability.reasoning) return false
  if (request.maxTokens && capability.maxOutputTokens && request.maxTokens > capability.maxOutputTokens) return false
  const estimatedInputTokens = JSON.stringify([...request.prefix, ...request.history]).length / 4
  if (capability.contextWindowTokens && estimatedInputTokens + (request.maxTokens ?? 0) > capability.contextWindowTokens) return false
  return true
}

function isContentChunk(chunk: ModelStreamChunk): boolean {
  return chunk.kind === 'assistant_text_delta' || chunk.kind === 'assistant_reasoning_delta' || chunk.kind === 'tool_call_delta' || chunk.kind === 'tool_call_complete' || chunk.kind === 'image_generation_complete'
}

function attributeRouteChunk(
  chunk: ModelStreamChunk,
  route: ModelRouteTargetMetadata
): ModelStreamChunk {
  if (chunk.kind !== 'usage') return { ...chunk, route }
  return {
    ...chunk,
    usage: {
      ...chunk.usage,
      requestedModelId: route.requestedModelId,
      actualProviderId: route.providerId,
      actualModelId: route.modelId,
      routePoolId: route.routePoolId,
      routeTargetId: route.targetId
    },
    route
  }
}

function routeFailureAllowed(pool: ModelRoutePoolConfig, failure: ModelFailureMetadata): boolean {
  if (!failure.failoverAllowed) return false
  if (failure.category === 'network') return pool.failurePolicy.failoverOnNetworkError
  if (failure.category === 'timeout') return pool.failurePolicy.failoverOnTimeout
  if (failure.category === 'authentication') return pool.failurePolicy.failoverOnAuthError
  return failure.httpStatus === undefined || pool.failurePolicy.failoverHttpStatusCodes.includes(failure.httpStatus)
}

function withRouteFailure(failure: ModelFailureMetadata | undefined, route: ModelRouteTargetMetadata): ModelFailureMetadata {
  return {
    ...(failure ?? { category: 'unknown' as const, failoverAllowed: false }),
    routePoolId: route.routePoolId,
    targetId: route.targetId,
    providerId: route.providerId,
    modelId: route.modelId
  }
}

function healthKey(poolId: string, targetId: string): string { return `${poolId}:${targetId}` }
function latency(state: RuntimeHealth): number { return state.ewmaLatencyMs ?? -1 }
function adaptiveScore(state: RuntimeHealth): number {
  const total = state.successes + state.failures
  if (total === 0) return Number.MAX_SAFE_INTEGER
  const successRate = state.successes / total
  return successRate * 10_000 - Math.log1p(state.ewmaLatencyMs ?? 1_000) * 100 - state.consecutiveFailures * 1_000
}
function rotate<T>(values: T[], offset: number): T[] { return [...values.slice(offset), ...values.slice(0, offset)] }
