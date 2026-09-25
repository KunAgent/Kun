import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type {
  ModelFailoverGroup,
  ModelFailoverStrategy,
  ModelFailureMetadata,
  ModelRoutePoolConfig,
  ModelRouteTargetConfig
} from '../../contracts/model-route-pool.js'
import { LOCAL_MODEL_GATEWAY_PROVIDER_ID } from '../../contracts/model-route-pool.js'
import type { ProviderQuotaEntry } from '../../contracts/provider-quota.js'
import type {
  ModelClient,
  ModelRequest,
  ModelRouteTargetMetadata,
  ModelStreamChunk
} from '../../ports/model-client.js'
import {
  createFailoverGroupRouteState,
  failoverGroupFallbackTargets,
  failoverGroupHealthTargets,
  failoverGroupMemberTargets,
  memberFailureTargetId,
  memberModelTargetId,
  orderFailoverGroupTargets,
  recordFailoverGroupSuccess
} from './route-pool-failover-groups.js'
import type { FailoverGroupRouteState } from './route-pool-failover-groups.js'
import { RoutePoolHealthStore } from './route-pool-health-store.js'
import type { RuntimeHealth } from './route-pool-health-store.js'

export { RoutePoolHealthStore } from './route-pool-health-store.js'
export type {
  ModelRouteEvent,
  PersistedRouteHealth,
  RouteTargetMetrics
} from './route-pool-health-store.js'


export class RoutePoolModelClient implements ModelClient {
  readonly provider = 'route-pool'
  get model(): string { return this.direct.model }
  private pools = new Map<string, ModelRoutePoolConfig>()
  private configured: ModelRoutePoolConfig[] = []
  private readonly roundRobin = new Map<string, number>()
  private readonly requestCounts = new Map<string, number>()
  private failoverByProvider = new Map<string, ModelFailoverGroup>()
  private readonly groupState: FailoverGroupRouteState = createFailoverGroupRouteState()
  private quotaLookup?: (providerId: string) => ProviderQuotaEntry | undefined

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
    this.health.prune([...this.pools.values(), ...this.failoverPools()])
  }

  /**
   * Provider-level failover groups (same-vendor account groups plus
   * cross-provider fallback chains). A request whose provider id is governed
   * by a group is routed through a synthesized pool so account exhaustion,
   * rotation, and fallback reuse the same health/cooldown machinery as
   * explicit model route pools.
   */
  replaceFailoverGroups(groups: readonly ModelFailoverGroup[]): void {
    this.failoverByProvider = new Map()
    for (const group of groups) {
      for (const member of group.members) {
        const key = member.providerId.trim().toLowerCase()
        if (key && !this.failoverByProvider.has(key)) {
          this.failoverByProvider.set(key, group)
        }
      }
    }
    this.health.prune([...this.pools.values(), ...this.failoverPools()])
  }

  /**
   * Read-only quota accessor wired by runtime composition. Only the cached
   * snapshot is consulted — routing never blocks on a live quota probe.
   */
  setQuotaLookup(lookup: ((providerId: string) => ProviderQuotaEntry | undefined) | undefined): void {
    this.quotaLookup = lookup
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
    return this.poolForRequest(request) !== undefined
  }

  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const routed = this.poolForRequest(request)
    return routed ? this.streamPool(routed.pool, request, routed.group) : this.direct.stream(request)
  }

  private poolForRequest(
    request: Pick<ModelRequest, 'model' | 'providerId'>
  ): { pool: ModelRoutePoolConfig; group?: ModelFailoverGroup } | undefined {
    const explicit = this.pools.get(request.model.trim().toLowerCase())
    if (explicit && shouldRouteRequest(explicit, request)) return { pool: explicit }
    const providerId = request.providerId?.trim().toLowerCase()
    const group = providerId ? this.failoverByProvider.get(providerId) : undefined
    if (!group) return undefined
    const pool = this.synthesizeGroupPool(group, request.model.trim(), providerId ?? '')
    return pool ? { pool, group } : undefined
  }

  /**
   * Synthesized pools exist only to drive health bookkeeping during pruning;
   * the per-request pool carries the concrete model id.
   */
  private failoverPools(): ModelRoutePoolConfig[] {
    const seen = new Set<string>()
    const pools: ModelRoutePoolConfig[] = []
    for (const group of this.failoverByProvider.values()) {
      if (seen.has(group.providerId)) continue
      seen.add(group.providerId)
      const targets = failoverGroupHealthTargets(group)
      if (targets.length > 0) {
        pools.push(synthesizedGroupPool(group, '', targets))
      }
    }
    return pools
  }

  /**
   * Builds the per-request pool for a failover group. Member ordering is not
   * applied here — `orderFailoverGroupTargets` orders members by strategy and
   * keeps fallbacks behind them.
   */
  private synthesizeGroupPool(
    group: ModelFailoverGroup,
    model: string,
    requestedProviderId: string
  ): ModelRoutePoolConfig | undefined {
    const targets = [
      ...failoverGroupMemberTargets(group, model, requestedProviderId),
      ...failoverGroupFallbackTargets(group)
    ]
    return targets.length > 0 ? synthesizedGroupPool(group, model, targets) : undefined
  }

  /** A quota entry counts as exhausted only on a definitive reading. */
  private quotaExhausted(providerId: string): boolean {
    return this.quotaUsedPercent(providerId) === 100
  }

  /** Highest reported quota usage in percent; undefined without a reading. */
  private quotaUsedPercent(providerId: string): number | undefined {
    const entry = this.quotaLookup?.(providerId)
    if (!entry || entry.status !== 'available') return undefined
    if (entry.metrics.some((metric) => metric.remaining !== undefined && metric.remaining <= 0)) {
      return 100
    }
    let used: number | undefined
    for (const metric of entry.metrics) {
      if (metric.usedPercent !== undefined) used = Math.max(used ?? 0, metric.usedPercent)
    }
    return used
  }

  /**
   * Two-level member health: a member target is unavailable when either the
   * account circuit (`member:<pid>`) or the model circuit
   * (`member:<pid>:<model>`) is open.
   */
  private targetAvailable(pool: ModelRoutePoolConfig, target: ModelRouteTargetConfig): boolean {
    if (!this.health.available(pool, target)) return false
    if (!target.id.startsWith('member:')) return true
    if (!target.modelId) return true
    return this.health.available(pool, {
      ...target,
      id: memberModelTargetId(target.providerId, target.modelId)
    })
  }

  /** Health-write target: credit/auth close the whole account, other reasons stay model-scoped. */
  private failureTarget(
    target: ModelRouteTargetConfig,
    failure: ModelFailureMetadata | undefined
  ): ModelRouteTargetConfig {
    if (!target.id.startsWith('member:')) return target
    const id = memberFailureTargetId(target.providerId, target.modelId, failure?.reason)
    return id === target.id ? target : { ...target, id }
  }

  /** Success clears both member health tiers so a healed model frees the account. */
  private recordHealthSuccess(
    pool: ModelRoutePoolConfig,
    target: ModelRouteTargetConfig,
    latencyMs: number,
    testId?: string
  ): void {
    this.health.success(pool, target, latencyMs, testId)
    if (target.id.startsWith('member:') && target.modelId) {
      this.health.success(pool, {
        ...target,
        id: memberModelTargetId(target.providerId, target.modelId)
      }, latencyMs, testId)
    }
  }

  private async *streamPool(
    pool: ModelRoutePoolConfig,
    request: ModelRequest,
    group?: ModelFailoverGroup
  ): AsyncIterable<ModelStreamChunk> {
    let eligible = pool.targets.filter((target) =>
      target.enabled &&
      this.targetAvailable(pool, target) &&
      targetSupportsRequest(target, request, this.capabilities))
    if (this.quotaLookup && eligible.length > 1) {
      // Quota-aware routing only applies to same-vendor member accounts:
      // a member whose cached quota entry is definitively exhausted is
      // skipped while at least one funded alternative remains. Fallback
      // providers are governed by their own ordering.
      const funded = eligible.filter((target) =>
        !target.id.startsWith('member:') || !this.quotaExhausted(target.providerId))
      if (funded.length > 0) eligible = funded
    }
    if (eligible.length === 0) {
      yield {
        kind: 'error',
        message: `route pool ${pool.modelId} has no healthy target that satisfies this request`,
        code: 'route_no_eligible_target',
        failure: { category: 'capability', failoverAllowed: false, routePoolId: pool.id }
      }
      return
    }
    const ordered = group
      ? orderFailoverGroupTargets({
          group,
          request,
          members: eligible.filter((target) => target.id.startsWith('member:')),
          fallbacks: eligible.filter((target) => !target.id.startsWith('member:')),
          usedPercent: (providerId) => this.quotaUsedPercent(providerId),
          state: this.groupState,
          now: this.now()
        })
      : this.orderTargets(pool, eligible)
    const failures: string[] = []
    let lastRejection: { providerId: string; modelId: string; reason?: string; message?: string } | undefined
    for (const [index, target] of ordered.entries()) {
      if (index > 0 && lastRejection) {
        // Surface the in-flight switch so a slow failover is visible instead
        // of looking like a stalled request. Not route-attributed: the first
        // observable route must remain the final committed route.
        yield {
          kind: 'route_switching',
          from: { providerId: lastRejection.providerId, modelId: lastRejection.modelId },
          to: { providerId: target.providerId, modelId: target.modelId },
          ...(lastRejection.reason ? { reason: lastRejection.reason } : {}),
          ...(lastRejection.message ? { message: lastRejection.message } : {})
        }
      }
      const started = this.now()
      this.health.begin(pool, target, request.routeTestId)
      const countKey = `${pool.id}:${target.id}`
      this.requestCounts.set(countKey, (this.requestCounts.get(countKey) ?? 0) + 1)
      const route: ModelRouteTargetMetadata = {
        routePoolId: pool.id,
        targetId: target.id,
        providerId: target.providerId,
        modelId: target.modelId,
        requestedModelId: request.model
      }
      let committed = false
      let failed = false
      let usageTokens = 0
      const pending: ModelStreamChunk[] = []
      try {
        for await (const chunk of this.direct.stream({
          ...request,
          model: target.modelId,
          providerId: target.providerId,
          routeSelection: {
            kind: 'route-pool',
            id: pool.id,
            targetProviderId: target.providerId
          },
          failover: { alternatives: ordered.length - index - 1 }
        })) {
          if (chunk.kind === 'usage') usageTokens = chunk.usage.totalTokens
          if (chunk.kind === 'error') {
            failed = true
            const latency = Math.max(0, this.now() - started)
            const failure = withRouteFailure(chunk.failure, route)
            if (healthCountable(failure)) {
              this.health.failure(
                pool, this.failureTarget(target, failure), latency, failure,
                chunk.message, request.routeTestId)
            }
            if (!committed && routeFailureAllowed(pool, failure)) {
              // Do not expose a rejected target. The first observable route is
              // therefore the immutable target that owns the response after
              // any pre-content failover.
              pending.length = 0
              lastRejection = {
                providerId: target.providerId,
                modelId: target.modelId,
                ...(failure.reason ? { reason: failure.reason } : {}),
                message: chunk.message
              }
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
        if (healthCountable(failure)) {
          this.health.failure(
            pool, this.failureTarget(target, failure), Math.max(0, this.now() - started),
            failure, message, request.routeTestId)
        }
        if (committed) {
          yield { kind: 'error', message, code: 'route_target_error', failure, route }
          return
        }
        lastRejection = { providerId: target.providerId, modelId: target.modelId, message }
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
          if (healthCountable(failure)) {
            this.health.failure(
              pool,
              this.failureTarget(target, failure),
              Math.max(0, this.now() - started),
              failure,
              message,
              request.routeTestId
            )
          }
          lastRejection = { providerId: target.providerId, modelId: target.modelId, message }
          failures.push(`${target.providerId}/${target.modelId}: ${message}`)
          continue
        }
        for (const buffered of pending) yield attributeRouteChunk(buffered, route)
        this.recordHealthSuccess(pool, target, Math.max(0, this.now() - started), request.routeTestId)
        if (group && target.id.startsWith('member:')) {
          recordFailoverGroupSuccess({
            state: this.groupState,
            groupId: group.providerId,
            threadId: request.threadId,
            providerId: target.providerId,
            tokens: usageTokens,
            now: this.now()
          })
        }
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
    if (pool.strategy === 'least-used') {
      // Stable sort: equal usage keeps the configured member order, so a
      // brand-new account never jumps ahead of the representative.
      return [...targets].sort((a, b) =>
        (this.requestCounts.get(`${pool.id}:${a.id}`) ?? 0) -
        (this.requestCounts.get(`${pool.id}:${b.id}`) ?? 0))
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

/**
 * Request-shape and model-mismatch failures are not the route target's
 * fault: they never decrement its health, open a circuit, or consume the
 * account's consecutive-failure budget.
 */
function healthCountable(failure: ModelFailureMetadata | undefined): boolean {
  return failure?.reason !== 'request' && failure?.reason !== 'model'
}

function routeFailureAllowed(pool: ModelRoutePoolConfig, failure: ModelFailureMetadata): boolean {
  if (!failure.failoverAllowed) return false
  if (failure.category === 'network') return pool.failurePolicy.failoverOnNetworkError
  if (failure.category === 'timeout') return pool.failurePolicy.failoverOnTimeout
  if (failure.category === 'authentication') return pool.failurePolicy.failoverOnAuthError
  // Deterministic account/capacity failures always qualify: retrying the same
  // credential cannot help regardless of which HTTP status carried them.
  if (
    failure.reason === 'credit' || failure.reason === 'quota' ||
    failure.reason === 'rate' || failure.reason === 'overloaded'
  ) return true
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


const FAILOVER_GROUP_STRATEGY: Record<ModelFailoverStrategy, ModelRoutePoolConfig['strategy']> = {
  // Nominal strategy for the synthesized pool only — member order is already
  // decided by orderGroupMembers before this pool is built, so this value
  // never drives adaptive selection at runtime.
  smart: 'adaptive',
  order: 'priority',
  rotate: 'round-robin',
  'least-used': 'least-used'
}

function synthesizedGroupPool(
  group: ModelFailoverGroup,
  model: string,
  targets: ModelRouteTargetConfig[]
): ModelRoutePoolConfig {
  return {
    id: `provider-failover:${group.providerId}`,
    name: group.providerId,
    modelId: model,
    enabled: true,
    strategy: FAILOVER_GROUP_STRATEGY[group.strategy],
    targets,
    failurePolicy: {
      failoverHttpStatusCodes: [401, 402, 403, 404, 408, 425, 429, 500, 502, 503, 504],
      failoverOnNetworkError: true,
      failoverOnTimeout: true,
      failoverOnAuthError: true
    },
    healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
  }
}

function latency(state: RuntimeHealth): number { return state.ewmaLatencyMs ?? -1 }
function adaptiveScore(state: RuntimeHealth): number {
  const total = state.successes + state.failures
  if (total === 0) return Number.MAX_SAFE_INTEGER
  const successRate = state.successes / total
  return successRate * 10_000 - Math.log1p(state.ewmaLatencyMs ?? 1_000) * 100 - state.consecutiveFailures * 1_000
}
function rotate<T>(values: T[], offset: number): T[] { return [...values.slice(offset), ...values.slice(0, offset)] }
