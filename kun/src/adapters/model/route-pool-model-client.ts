import { accountModelRequest } from './request-attempt-accounting.js'
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
import { orderRouteTargets } from './route-target-order.js'
import { capabilitySupportsRequest } from './route-capability-contract.js'
import { GatewayRouteChangedError, gatewayTargetMatches } from '../../domain/model-gateway-export-policy.js'
import { GATEWAY_MAX_ROUTE_ATTEMPTS, withGatewayRoutingBudget } from './gateway-routing-budget.js'
import { RouteAffinity } from './route-affinity.js'
import { demoteOverflow, effortFor, estimateRequestTokens, flattenNestedPools, orderByDecision, routeDecisionSource, RouteRuleEngine } from './route-rules.js'

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
  private readonly affinity: RouteAffinity
  private readonly rules: RouteRuleEngine

  constructor(
    private readonly direct: ModelClient,
    pools: readonly ModelRoutePoolConfig[],
    private readonly capabilities: (model: string, providerId?: string) => ModelCapabilityMetadata,
    readonly health: RoutePoolHealthStore = new RoutePoolHealthStore(),
    private readonly now: () => number = Date.now
  ) {
    this.affinity = new RouteAffinity(now)
    this.rules = new RouteRuleEngine(() => this.direct, now)
    this.replacePools(pools)
  }

  replacePools(pools: readonly ModelRoutePoolConfig[]): void {
    // Affinity entries are revalidated against the current targets on use, so a
    // configuration change does not need to forget which account holds a cache.
    this.rules.clear()
    this.configured = pools.map((pool) => structuredClone(pool))
    // Nested aliases are flattened once per configuration, with cycle and depth checks.
    this.pools = new Map(flattenNestedPools(pools).filter((pool) => pool.enabled).map((pool) => [pool.modelId.toLowerCase(), structuredClone(pool)]))
    this.roundRobin.clear()
    this.requestCounts.clear()
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

  /** Persist conversation affinity so a restart keeps prompt-cache locality. */
  persistAffinity(file: string): void {
    this.affinity.persistTo(file)
  }

  flushAffinity(): void {
    this.affinity.flush()
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

  paperReadOnlyDispatchGuard(request: Pick<ModelRequest, 'model' | 'providerId'>): () => void {
    if (this.poolForRequest(request)) throw new Error('Paper reading requires a fixed provider and model, without automatic failover')
    if (!this.direct.paperReadOnlyDispatchGuard) throw new Error('Paper read-only transport is unavailable')
    const guard = this.direct.paperReadOnlyDispatchGuard(request)
    return () => {
      if (this.poolForRequest(request)) throw new Error('Paper routing changed after disclosure')
      guard()
    }
  }

  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    request.paperReadOnly?.assertCurrent()
    return accountModelRequest(request, (accounted) => this.streamWithBudget(accounted))
  }

  private streamWithBudget(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    return (request.gatewayRouting || this.poolForRequest(request)) && !request.routingBudget
      ? withGatewayRoutingBudget(request, (bounded) => this.streamRouted(bounded))
      : this.streamRouted(request)
  }

  private streamRouted(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const routed = this.poolForRequest(request)
    if (!routed && request.gatewayRouting && !gatewayAllowsTarget(request, {
      providerId: request.providerId ?? '', modelId: request.model
    })) return rejectedGatewayTarget()
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
    const observed = entry?.updatedAt ? Date.parse(entry.updatedAt) : NaN
    if (!entry || entry.status !== 'available' || !Number.isFinite(observed) ||
      this.now() - observed > 5 * 60_000 || observed > this.now()) return undefined
    const metrics = entry.metrics.filter((metric) => !metric.resetsAt || Date.parse(metric.resetsAt) > this.now())
    if (metrics.some((metric) => metric.remaining !== undefined && metric.remaining <= 0)) {
      return 100
    }
    let used: number | undefined
    for (const metric of metrics) {
      if (metric.usedPercent !== undefined) used = Math.max(used ?? 0, metric.usedPercent)
    }
    return used
  }

  /** Percent of the longest live window still unused, per hour until it resets. */
  private quotaPace(providerId: string): number | undefined {
    const entry = this.quotaLookup?.(providerId)
    if (!entry || entry.status !== 'available') return undefined
    const now = this.now()
    const windows = entry.metrics.filter((metric) => metric.usedPercent !== undefined && metric.resetsAt && Date.parse(metric.resetsAt) > now)
      .sort((a, b) => Date.parse(b.resetsAt!) - Date.parse(a.resetsAt!))
    const longest = windows[0]
    if (!longest) return undefined
    const hours = Math.max(1 / 60, (Date.parse(longest.resetsAt!) - now) / 3_600_000)
    return Math.max(0, 100 - longest.usedPercent!) / hours
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
    const authorized = pool.targets.filter((target) => target.enabled && gatewayAllowsTarget(request, target))
    if (pool.capabilityMode === 'guaranteed' && authorized.some((target) =>
      !capabilitySupportsRequest(this.capabilities(target.modelId, target.providerId), request))) {
      yield { kind: 'error', code: 'route_capability_not_guaranteed', message: 'This request exceeds the route guarantee. Select request capability filtering or change its targets.',
        failure: { category: 'capability', failoverAllowed: false, routePoolId: pool.id } }
      return
    }
    let eligible = pool.targets.filter((target) =>
      target.enabled &&
      gatewayAllowsTarget(request, target) &&
      this.targetAvailable(pool, target) &&
      capabilitySupportsRequest(this.capabilities(target.modelId, target.providerId), request))
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
    const decision = group ? {} : await this.rules.decide(pool, request)
    const base = group
      ? orderFailoverGroupTargets({
          group,
          request,
          members: eligible.filter((target) => target.id.startsWith('member:')),
          fallbacks: eligible.filter((target) => !target.id.startsWith('member:')),
          usedPercent: (providerId) => this.quotaUsedPercent(providerId),
          pace: (providerId) => this.quotaPace(providerId),
          state: this.groupState,
          now: this.now()
        })
      : this.orderTargets(pool, eligible)
    const preferred = this.affinity.prefer(pool, request, base)
    const ruled = orderByDecision(preferred, decision)
    const ordered = pool.overflowMove === false ? ruled
      : demoteOverflow(ruled, estimateRequestTokens(request), (modelId, providerId) => this.capabilities(modelId, providerId))
    // What put the first member first, for route traces.
    const firstSource = routeDecisionSource({ base, preferred, ruled, ordered, decision, group: Boolean(group), manual: pool.strategy === 'manual' })
    const failures: string[] = []
    let lastRejection: { providerId: string; modelId: string; reason?: string; message?: string } | undefined
    const attempts = request.gatewayRouting || request.routingBudget ? ordered.slice(0, GATEWAY_MAX_ROUTE_ATTEMPTS) : ordered
    for (const [index, target] of attempts.entries()) {
      request.abortSignal.throwIfAborted()
      const releaseHealth = this.health.acquire(pool, [target,
        ...(target.id.startsWith('member:') && target.modelId ? [{ ...target,
          id: memberModelTargetId(target.providerId, target.modelId) }] : [])], request.routeTestId)
      if (!releaseHealth) continue
      const started = this.now()
      const countKey = `${pool.id}:${target.id}`
      this.requestCounts.set(countKey, (this.requestCounts.get(countKey) ?? 0) + 1)
      const route: ModelRouteTargetMetadata = {
        routePoolId: pool.id,
        targetId: target.id,
        providerId: target.providerId,
        modelId: target.modelId,
        requestedModelId: request.model,
        ...(decision.ruleId ? { ruleId: decision.ruleId } : {}),
        decision: index === 0 ? firstSource : 'failover',
        ...(decision.intent ? { intent: decision.intent } : {})
      }
      const effort = effortFor(target, decision, request.reasoningEffort)
      let committed = false
      let failed = false
      let usageTokens = 0
      let healthSucceeded = false
      const recordSuccess = () => {
        if (healthSucceeded) return
        healthSucceeded = true
        this.recordHealthSuccess(pool, target, Math.max(0, this.now() - started), request.routeTestId)
        if (group && target.id.startsWith('member:')) recordFailoverGroupSuccess({ state: this.groupState,
          groupId: group.providerId, threadId: request.threadId, providerId: target.providerId,
          tokens: usageTokens, now: this.now() })
      }
      const pending: ModelStreamChunk[] = []
      let pendingBytes = 0
      try {
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
        for await (const chunk of this.direct.stream({
          ...request,
          model: target.modelId,
          providerId: target.providerId,
          ...(effort ? { reasoningEffort: effort } : {}),
          routeSelection: {
            kind: 'route-pool',
            id: pool.id,
            targetProviderId: target.providerId
          },
          failover: { alternatives: attempts.length - index - 1 }
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
            } else {
              this.health.abandon(pool, target)
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
            pendingBytes += new TextEncoder().encode(JSON.stringify(chunk)).byteLength
            if (pending.length >= 128 || pendingBytes > 256_000) {
              yield { kind: 'error', code: 'route_precommit_limit', message: 'Provider emitted too much metadata before response content.',
                failure: { category: 'request', reason: 'request', failoverAllowed: false } }
              return
            }
            pending.push(chunk)
            continue
          }
          if (!committed) {
            committed = true
            this.affinity.committed(pool, request, target)
            for (const buffered of pending) yield attributeRouteChunk(buffered, route)
            pending.length = 0
          }
          if (chunk.kind === 'completed' && chunk.stopReason === 'error') {
            failed = true
            this.health.failure(pool, target, Math.max(0, this.now() - started),
              { category: 'unavailable', failoverAllowed: false }, 'Provider completed with an error', request.routeTestId)
            yield attributeRouteChunk(chunk, route)
            return
          }
          if (chunk.kind === 'completed') recordSuccess()
          yield attributeRouteChunk(chunk, route)
        }
      } catch (error) {
        // Cancellation/deadline is terminal and is not an upstream outage.
        if (request.abortSignal.aborted) throw request.abortSignal.reason ?? error
        if (error instanceof GatewayRouteChangedError) {
          yield { kind: 'error', code: 'gateway_route_changed', message: error.message,
            failure: { category: 'request', failoverAllowed: false } }
          return
        }
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
      } finally {
        releaseHealth()
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
        recordSuccess()
        return
      }
    }
    yield {
      kind: 'error',
      message: `route pool ${pool.modelId} exhausted ${failures.length} target(s): ${failures.join(' | ').slice(0, 1_500)}`,
      code: attempts.length < ordered.length ? 'route_attempt_budget_exhausted' : 'route_targets_exhausted',
      failure: { category: 'unavailable', failoverAllowed: false, routePoolId: pool.id }
    }
  }

  previewOrder(pool: ModelRoutePoolConfig, targets: ModelRouteTargetConfig[]): ModelRouteTargetConfig[] {
    return orderRouteTargets(pool, targets, this.health, this.requestCounts, this.roundRobin.get(pool.id) ?? 0)
  }

  private orderTargets(pool: ModelRoutePoolConfig, targets: ModelRouteTargetConfig[]): ModelRouteTargetConfig[] {
    const ordered = this.previewOrder(pool, targets)
    if (pool.strategy === 'round-robin' || pool.strategy === 'weighted-round-robin') {
      this.roundRobin.set(pool.id, (this.roundRobin.get(pool.id) ?? 0) + 1)
    }
    return ordered
  }
}

function gatewayAllowsTarget(request: ModelRequest, target: { providerId: string; modelId: string }): boolean {
  return !request.gatewayRouting || request.gatewayRouting.allowedTargets.some((allowed) => gatewayTargetMatches(allowed, target))
}

async function* rejectedGatewayTarget(): AsyncIterable<ModelStreamChunk> {
  yield { kind: 'error', code: 'gateway_route_not_allowed', message: 'Gateway route is not authorized.',
    failure: { category: 'request', failoverAllowed: false } }
}

function shouldRouteRequest(
  pool: ModelRoutePoolConfig,
  request: Pick<ModelRequest, 'providerId'>
): boolean {
  const providerId = request.providerId?.trim().toLowerCase()
  if (!providerId) return true
  return providerId === LOCAL_MODEL_GATEWAY_PROVIDER_ID || providerId === `route-pool:${pool.id}`.toLowerCase()
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
  return !failure?.localAdmission && !['request', 'capability', 'model_not_found'].includes(failure?.category ?? '') &&
    failure?.reason !== 'request' && failure?.reason !== 'model'
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
  'least-used': 'least-used',
  pace: 'priority'
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
