import type { UsageSnapshot } from '../contracts/usage.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'

export type UsageEntity = UsageSnapshot

export function zeroUsage(): UsageSnapshot {
  return emptyUsageSnapshot()
}

export function addUsage(into: UsageSnapshot, delta: UsageSnapshot): UsageSnapshot {
  const promptTokens = into.promptTokens + delta.promptTokens
  const completionTokens = into.completionTokens + delta.completionTokens
  const reasoningTokens = sumOptional(into.reasoningTokens, delta.reasoningTokens)
  const totalTokens = promptTokens + completionTokens
  const cachedTokens = (into.cachedTokens ?? 0) + (delta.cachedTokens ?? 0)
  const cacheHitTokens =
    (into.cacheHitTokens ?? 0) + (delta.cacheHitTokens ?? 0)
  const cacheMissTokens =
    (into.cacheMissTokens ?? 0) + (delta.cacheMissTokens ?? 0)
  const cacheWriteTokens = sumOptional(into.cacheWriteTokens, delta.cacheWriteTokens)
  const cacheTotal = cacheHitTokens + cacheMissTokens
  const cacheHitRate =
    cacheTotal === 0
      ? null
      : cacheHitTokens / cacheTotal
  // Union diagnostic string arrays across all folded deltas instead of
  // clobbering the accumulated set with only the latest turn's values.
  const cacheMissReasons = unionStrings(into.cacheMissReasons, delta.cacheMissReasons)
  const cacheSuggestions = unionStrings(into.cacheSuggestions, delta.cacheSuggestions)
  // Per-turn hit rates are not additive: carrying a single delta's rate into an
  // accumulated total would be a meaningless stale snapshot. Recompute from the
  // aggregated token counts when cache telemetry is present, otherwise leave
  // unset so consumers do not read a fabricated rate.
  const cacheableTokenHitRate = cacheTotal > 0 ? cacheHitTokens / cacheTotal : undefined
  const totalInputTokenHitRate =
    promptTokens > 0 && cacheTotal > 0 ? cacheHitTokens / promptTokens : undefined
  const turns = into.turns + delta.turns
  const costUsd =
    into.costUsd === undefined && delta.costUsd === undefined
      ? undefined
      : (into.costUsd ?? 0) + (delta.costUsd ?? 0)
  const costCny =
    into.costCny === undefined && delta.costCny === undefined
      ? undefined
      : (into.costCny ?? 0) + (delta.costCny ?? 0)
  const costByCurrency = mergeCurrencyCosts(into.costByCurrency, delta.costByCurrency)
  const cacheSavingsUsd =
    into.cacheSavingsUsd === undefined && delta.cacheSavingsUsd === undefined
      ? undefined
      : (into.cacheSavingsUsd ?? 0) + (delta.cacheSavingsUsd ?? 0)
  const cacheSavingsCny =
    into.cacheSavingsCny === undefined && delta.cacheSavingsCny === undefined
      ? undefined
      : (into.cacheSavingsCny ?? 0) + (delta.cacheSavingsCny ?? 0)
  const tokenEconomySavingsTokens =
    (into.tokenEconomySavingsTokens ?? 0) + (delta.tokenEconomySavingsTokens ?? 0)
  const tokenEconomySavingsUsd =
    into.tokenEconomySavingsUsd === undefined && delta.tokenEconomySavingsUsd === undefined
      ? undefined
      : (into.tokenEconomySavingsUsd ?? 0) + (delta.tokenEconomySavingsUsd ?? 0)
  const tokenEconomySavingsCny =
    into.tokenEconomySavingsCny === undefined && delta.tokenEconomySavingsCny === undefined
      ? undefined
      : (into.tokenEconomySavingsCny ?? 0) + (delta.tokenEconomySavingsCny ?? 0)
  return {
    promptTokens,
    completionTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    totalTokens,
    cachedTokens,
    cacheHitTokens,
    cacheMissTokens,
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    cacheHitRate,
    cacheableTokenHitRate,
    totalInputTokenHitRate,
    cacheMissReasons,
    cacheSuggestions,
    ...(delta.actualProviderId ? { actualProviderId: delta.actualProviderId } : into.actualProviderId ? { actualProviderId: into.actualProviderId } : {}),
    ...(delta.actualModelId ? { actualModelId: delta.actualModelId } : into.actualModelId ? { actualModelId: into.actualModelId } : {}),
    ...(delta.billingKind ? { billingKind: delta.billingKind } : into.billingKind ? { billingKind: into.billingKind } : {}),
    ...(delta.serviceTier ? { serviceTier: delta.serviceTier } : into.serviceTier ? { serviceTier: into.serviceTier } : {}),
    ...(delta.requestedModelId ? { requestedModelId: delta.requestedModelId } : into.requestedModelId ? { requestedModelId: into.requestedModelId } : {}),
    ...(delta.routePoolId ? { routePoolId: delta.routePoolId } : into.routePoolId ? { routePoolId: into.routePoolId } : {}),
    ...(delta.routeTargetId ? { routeTargetId: delta.routeTargetId } : into.routeTargetId ? { routeTargetId: into.routeTargetId } : {}),
    turns,
    costUsd,
    costCny,
    ...(costByCurrency ? { costByCurrency } : {}),
    cacheSavingsUsd,
    cacheSavingsCny,
    tokenEconomySavingsTokens,
    tokenEconomySavingsUsd,
    tokenEconomySavingsCny
  }
}

/**
 * Convert two cumulative usage snapshots into one durable per-request delta.
 * Attribution and point-in-time timing fields come from the newer snapshot;
 * monotonic counters are subtracted and clamped at zero.
 */
export function diffUsage(current: UsageSnapshot, previous: UsageSnapshot): UsageSnapshot {
  const promptTokens = diffNumber(current.promptTokens, previous.promptTokens)
  const completionTokens = diffNumber(current.completionTokens, previous.completionTokens)
  const reportedTotal = diffNumber(current.totalTokens, previous.totalTokens)
  const totalTokens = reportedTotal || promptTokens + completionTokens
  const reasoningTokens = diffOptionalNumber(current.reasoningTokens, previous.reasoningTokens)
  const cachedTokens = diffOptionalNumber(current.cachedTokens, previous.cachedTokens)
  const cacheHitTokens = diffOptionalNumber(current.cacheHitTokens, previous.cacheHitTokens)
  const cacheMissTokens = diffOptionalNumber(current.cacheMissTokens, previous.cacheMissTokens)
  const cacheWriteTokens = diffOptionalNumber(current.cacheWriteTokens, previous.cacheWriteTokens)
  const cacheTotal = (cacheHitTokens ?? 0) + (cacheMissTokens ?? 0)
  const costByCurrency = diffCurrencyCosts(current.costByCurrency, previous.costByCurrency)
  return {
    promptTokens,
    completionTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    totalTokens,
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(cacheHitTokens !== undefined ? { cacheHitTokens } : {}),
    ...(cacheMissTokens !== undefined ? { cacheMissTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    cacheHitRate: cacheHitTokens !== undefined && cacheTotal > 0
      ? cacheHitTokens / cacheTotal
      : null,
    ...(current.cacheableTokenHitRate !== undefined
      ? { cacheableTokenHitRate: current.cacheableTokenHitRate }
      : {}),
    ...(current.totalInputTokenHitRate !== undefined
      ? { totalInputTokenHitRate: current.totalInputTokenHitRate }
      : {}),
    ...(current.cacheMissReasons ? { cacheMissReasons: [...current.cacheMissReasons] } : {}),
    ...(current.cacheSuggestions ? { cacheSuggestions: [...current.cacheSuggestions] } : {}),
    ...(current.actualProviderId ? { actualProviderId: current.actualProviderId } : {}),
    ...(current.actualModelId ? { actualModelId: current.actualModelId } : {}),
    ...(current.billingKind ? { billingKind: current.billingKind } : {}),
    ...(current.serviceTier ? { serviceTier: current.serviceTier } : {}),
    ...(current.requestedModelId ? { requestedModelId: current.requestedModelId } : {}),
    ...(current.routePoolId ? { routePoolId: current.routePoolId } : {}),
    ...(current.routeTargetId ? { routeTargetId: current.routeTargetId } : {}),
    turns: diffNumber(current.turns, previous.turns),
    ...diffOptionalField('costUsd', current, previous),
    ...diffOptionalField('costCny', current, previous),
    ...(costByCurrency ? { costByCurrency } : {}),
    ...diffOptionalField('cacheSavingsUsd', current, previous),
    ...diffOptionalField('cacheSavingsCny', current, previous),
    ...diffOptionalField('tokenEconomySavingsTokens', current, previous),
    ...diffOptionalField('tokenEconomySavingsUsd', current, previous),
    ...diffOptionalField('tokenEconomySavingsCny', current, previous),
    ...(current.hasError ? { hasError: true } : {}),
    ...(current.avgTtftMs !== undefined ? { avgTtftMs: current.avgTtftMs } : {}),
    ...(current.avgTokensPerSecond !== undefined
      ? { avgTokensPerSecond: current.avgTokensPerSecond }
      : {})
  }
}

export function hasUsage(usage: UsageSnapshot): boolean {
  return usage.promptTokens > 0
    || usage.completionTokens > 0
    || (usage.reasoningTokens ?? 0) > 0
    || usage.totalTokens > 0
    || (usage.cachedTokens ?? 0) > 0
    || (usage.cacheHitTokens ?? 0) > 0
    || (usage.cacheMissTokens ?? 0) > 0
    || (usage.cacheWriteTokens ?? 0) > 0
    || usage.turns > 0
    || (usage.costUsd ?? 0) > 0
    || (usage.costCny ?? 0) > 0
    || Object.values(usage.costByCurrency ?? {}).some((cost) => cost > 0)
    || (usage.cacheSavingsUsd ?? 0) > 0
    || (usage.cacheSavingsCny ?? 0) > 0
    || (usage.tokenEconomySavingsTokens ?? 0) > 0
    || (usage.tokenEconomySavingsUsd ?? 0) > 0
    || (usage.tokenEconomySavingsCny ?? 0) > 0
}

function sumOptional(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0)
}

function diffNumber(current: number, previous: number): number {
  return Math.max(0, current - previous)
}

function diffOptionalNumber(current?: number, previous?: number): number | undefined {
  if (current === undefined && previous === undefined) return undefined
  return Math.max(0, (current ?? 0) - (previous ?? 0))
}

type DifferentialNumericField =
  | 'costUsd'
  | 'costCny'
  | 'cacheSavingsUsd'
  | 'cacheSavingsCny'
  | 'tokenEconomySavingsTokens'
  | 'tokenEconomySavingsUsd'
  | 'tokenEconomySavingsCny'

function diffOptionalField(
  key: DifferentialNumericField,
  current: UsageSnapshot,
  previous: UsageSnapshot
): Partial<UsageSnapshot> {
  const left = current[key]
  const right = previous[key]
  if (left !== undefined && right !== undefined && left === right) return {}
  const difference = diffOptionalNumber(left, right)
  return difference === undefined ? {} : { [key]: difference }
}

function diffCurrencyCosts(
  current: Record<string, number> | undefined,
  previous: Record<string, number> | undefined
): Record<string, number> | undefined {
  if (!current && !previous) return undefined
  const currencies = new Set([...Object.keys(current ?? {}), ...Object.keys(previous ?? {})])
  const differences = [...currencies].flatMap((currency) => {
    const left = current?.[currency]
    const right = previous?.[currency]
    if (left !== undefined && right !== undefined && left === right) return []
    return [[currency, Math.max(0, (left ?? 0) - (right ?? 0))] as const]
  })
  return differences.length > 0 ? Object.fromEntries(differences) : undefined
}

function mergeCurrencyCosts(
  left: Record<string, number> | undefined,
  right: Record<string, number> | undefined
): Record<string, number> | undefined {
  if (!left && !right) return undefined
  const merged: Record<string, number> = { ...(left ?? {}) }
  for (const [currency, cost] of Object.entries(right ?? {})) {
    merged[currency] = (merged[currency] ?? 0) + cost
  }
  return merged
}

/**
 * Merge two optional string lists into a deduplicated union, preserving first-
 * seen order. Returns `undefined` when neither side carried any values so the
 * "no telemetry reported" signal is not turned into an empty array.
 */
function unionStrings(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
): string[] | undefined {
  if (!left?.length && !right?.length) return undefined
  const merged: string[] = []
  const seen = new Set<string>()
  for (const value of [...(left ?? []), ...(right ?? [])]) {
    if (seen.has(value)) continue
    seen.add(value)
    merged.push(value)
  }
  return merged
}
