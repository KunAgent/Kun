import type {
  ModelFailoverGroup,
  ModelFailoverStrategy,
  ModelRouteTargetConfig
} from '../../contracts/model-route-pool.js'

/**
 * Provider failover-group routing state, held per RoutePoolModelClient.
 * Members (same-vendor accounts) and fallback targets are ordered by
 * different rules: fallbacks always keep their configured order and only
 * run after every member has been rejected, while members follow the
 * configured account strategy.
 */
export type FailoverGroupRouteState = {
  /** `${groupId}:${threadId}` -> last member that produced content. */
  affinity: Map<string, { providerId: string; touchedAt: number }>
  /** groupId -> rotation cursor for the `rotate` strategy. */
  rotation: Map<string, number>
  /** `${groupId}:${providerId}` -> decaying served-token counter. */
  usage: Map<string, { value: number; at: number }>
}

export function createFailoverGroupRouteState(): FailoverGroupRouteState {
  return { affinity: new Map(), rotation: new Map(), usage: new Map() }
}

const AFFINITY_MAX_ENTRIES = 2_000
const AFFINITY_MAX_AGE_MS = 6 * 60 * 60 * 1_000
/** Token counters halve every hour so least-used prefers recent low usage. */
const USAGE_HALF_LIFE_MS = 60 * 60 * 1_000
const QUOTA_HEADROOM_PERCENT = 90
const QUOTA_NEAR_EXHAUSTION_PERCENT = 98

/**
 * Account-level health target id: credit and auth failures are recorded on
 * `member:<pid>` and close every model the account serves; other reasons are
 * recorded on `member:<pid>:<model>` so a single-model outage does not block
 * the account's other models.
 */
export function memberAccountTargetId(providerId: string): string {
  return `member:${providerId}`
}

export function memberModelTargetId(providerId: string, modelId: string): string {
  return `member:${providerId}:${modelId}`
}

export function memberHealthTargetIds(providerId: string, modelId: string): string[] {
  const account = memberAccountTargetId(providerId)
  const model = memberModelTargetId(providerId, modelId)
  return account === model ? [account] : [account, model]
}

/** Health-write target for a member failure: account-wide vs model-scoped. */
export function memberFailureTargetId(providerId: string, modelId: string, reason?: string): string {
  return reason === 'credit' || reason === 'auth'
    ? memberAccountTargetId(providerId)
    : memberModelTargetId(providerId, modelId)
}

/**
 * Member candidates for one request. The explicitly requested member is
 * always a candidate even when its declared model list lacks the model —
 * the user pointed at that account deliberately. Other members only serve
 * models they declare (case-insensitive); a member with an empty model list
 * never serves a concrete request.
 */
export function failoverGroupMemberTargets(
  group: ModelFailoverGroup,
  model: string,
  requestedProviderId?: string
): ModelRouteTargetConfig[] {
  const wanted = model.trim().toLowerCase()
  const requested = requestedProviderId?.trim().toLowerCase()
  const targets: ModelRouteTargetConfig[] = []
  for (const member of group.members) {
    if (!member.enabled) continue
    const isRequested = requested !== undefined && requested === member.providerId.trim().toLowerCase()
    if (!isRequested) {
      if (!wanted || !member.models.some((entry) => entry.trim().toLowerCase() === wanted)) continue
    }
    targets.push({
      id: memberAccountTargetId(member.providerId),
      providerId: member.providerId,
      modelId: model,
      enabled: true,
      weight: 1
    })
  }
  return targets
}

/** Fallback targets keep their declared order and never join member ordering. */
export function failoverGroupFallbackTargets(group: ModelFailoverGroup): ModelRouteTargetConfig[] {
  return group.fallbackTargets.map((target) => ({
    id: `fallback:${target.providerId}:${target.modelId}`,
    providerId: target.providerId,
    modelId: target.modelId,
    enabled: true,
    weight: 1
  }))
}

/**
 * Health-prune target list for a group: account-level member ids plus one
 * model-scoped id per declared member model so both health tiers survive.
 */
export function failoverGroupHealthTargets(group: ModelFailoverGroup): ModelRouteTargetConfig[] {
  const targets: ModelRouteTargetConfig[] = []
  for (const member of group.members) {
    if (!member.enabled) continue
    targets.push({
      id: memberAccountTargetId(member.providerId),
      providerId: member.providerId,
      modelId: '',
      enabled: true,
      weight: 1
    })
    for (const model of member.models) {
      targets.push({
        id: memberModelTargetId(member.providerId, model),
        providerId: member.providerId,
        modelId: model,
        enabled: true,
        weight: 1
      })
    }
  }
  targets.push(...failoverGroupFallbackTargets(group))
  return targets
}

/**
 * Orders one group's candidates: members first (strategy-dependent),
 * fallbacks last in configured order. `members`/`fallbacks` must already be
 * filtered for health and capability.
 */
export function orderFailoverGroupTargets(input: {
  group: ModelFailoverGroup
  request: { threadId: string; model: string; providerId?: string }
  members: ModelRouteTargetConfig[]
  fallbacks: ModelRouteTargetConfig[]
  usedPercent: (providerId: string) => number | undefined
  state: FailoverGroupRouteState
  now: number
}): ModelRouteTargetConfig[] {
  const ordered = orderGroupMembers(input)
  return [...ordered, ...input.fallbacks]
}

function orderGroupMembers(input: {
  group: ModelFailoverGroup
  request: { threadId: string; model: string; providerId?: string }
  members: ModelRouteTargetConfig[]
  usedPercent: (providerId: string) => number | undefined
  state: FailoverGroupRouteState
  now: number
}): ModelRouteTargetConfig[] {
  const { group, request, members, usedPercent, state, now } = input
  switch (group.strategy as ModelFailoverStrategy) {
    case 'rotate': {
      const cursor = state.rotation.get(group.providerId) ?? 0
      state.rotation.set(group.providerId, cursor + 1)
      if (members.length === 0) return members
      const offset = cursor % members.length
      return [...members.slice(offset), ...members.slice(0, offset)]
    }
    case 'least-used':
      return [...members].sort((a, b) => {
        const quotaDelta = (usedPercent(a.providerId) ?? 0) - (usedPercent(b.providerId) ?? 0)
        if (quotaDelta !== 0) return quotaDelta
        return decayedUsage(state, group.providerId, a.providerId, now) -
          decayedUsage(state, group.providerId, b.providerId, now)
      })
    case 'order': {
      const requested = request.providerId?.trim().toLowerCase()
      if (!requested) return [...members]
      return [...members].sort((a, b) =>
        Number(b.providerId.trim().toLowerCase() === requested) -
        Number(a.providerId.trim().toLowerCase() === requested))
    }
    case 'smart':
    default: {
      const under = (percent: number | undefined): boolean =>
        percent === undefined || percent < QUOTA_HEADROOM_PERCENT
      const affinityKey = `${group.providerId}:${request.threadId}`
      const affinityProvider = state.affinity.get(affinityKey)?.providerId.trim().toLowerCase()
      const requested = request.providerId?.trim().toLowerCase()
      const rank = (target: ModelRouteTargetConfig): { tier: number; used: number } => {
        const pid = target.providerId.trim().toLowerCase()
        const used = usedPercent(target.providerId) ?? 0
        if (affinityProvider && pid === affinityProvider && under(usedPercent(target.providerId))) {
          return { tier: 0, used }
        }
        if (requested && pid === requested) return { tier: 1, used }
        if (used < QUOTA_HEADROOM_PERCENT) return { tier: 2, used }
        if (used < QUOTA_NEAR_EXHAUSTION_PERCENT) return { tier: 3, used }
        return { tier: 4, used }
      }
      return [...members].sort((a, b) => {
        const ra = rank(a)
        const rb = rank(b)
        if (ra.tier !== rb.tier) return ra.tier - rb.tier
        // Within the near-exhaustion tier prefer more headroom; elsewhere a
        // stable sort keeps the configured member order.
        return ra.tier === 3 ? ra.used - rb.used : 0
      })
    }
  }
}

/** Records a successful member route: thread affinity plus decaying usage. */
export function recordFailoverGroupSuccess(input: {
  state: FailoverGroupRouteState
  groupId: string
  threadId: string
  providerId: string
  tokens: number
  now: number
}): void {
  const { state, groupId, threadId, providerId, tokens, now } = input
  pruneFailoverGroupRouteState(state, now)
  state.affinity.set(`${groupId}:${threadId}`, { providerId, touchedAt: now })
  const key = `${groupId}:${providerId}`
  const current = state.usage.get(key)
  const decayed = current ? current.value * Math.pow(0.5, (now - current.at) / USAGE_HALF_LIFE_MS) : 0
  state.usage.set(key, { value: decayed + Math.max(0, tokens), at: now })
}

function decayedUsage(
  state: FailoverGroupRouteState,
  groupId: string,
  providerId: string,
  now: number
): number {
  const entry = state.usage.get(`${groupId}:${providerId}`)
  if (!entry) return 1 // unknown usage counts as the smallest non-zero weight
  return entry.value * Math.pow(0.5, (now - entry.at) / USAGE_HALF_LIFE_MS)
}

function pruneFailoverGroupRouteState(state: FailoverGroupRouteState, now: number): void {
  if (state.affinity.size > AFFINITY_MAX_ENTRIES) {
    const entries = [...state.affinity.entries()]
      .sort((a, b) => a[1].touchedAt - b[1].touchedAt)
    for (const [key] of entries.slice(0, state.affinity.size - AFFINITY_MAX_ENTRIES)) {
      state.affinity.delete(key)
    }
  }
  for (const [key, entry] of state.affinity) {
    if (now - entry.touchedAt > AFFINITY_MAX_AGE_MS) state.affinity.delete(key)
  }
  for (const [key, entry] of state.usage) {
    if (entry.value * Math.pow(0.5, (now - entry.at) / USAGE_HALF_LIFE_MS) < 0.01) {
      state.usage.delete(key)
    }
  }
}
