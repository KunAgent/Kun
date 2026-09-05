import type { UsageSnapshot } from '../contracts/usage.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'

/**
 * Per-thread usage counter. The counter accumulates token, cache,
 * turn, and cost counters across model responses. The counter never
 * throws; missing values fall back to zero/empty.
 */
export class UsageCounter {
  private perThread = new Map<string, UsageSnapshot>()
  private readonly dirtyThreads = new Set<string>()
  /** Raw per-request timing sums keyed by thread, used to derive averages. */
  private readonly timing = new Map<string, TimingAgg>()

  reset(threadId?: string): void {
    if (threadId === undefined) {
      this.perThread.clear()
      this.timing.clear()
      this.dirtyThreads.clear()
      return
    }
    this.perThread.delete(threadId)
    this.timing.delete(threadId)
    this.dirtyThreads.delete(threadId)
  }

  seed(threadId: string, snapshot: UsageSnapshot): UsageSnapshot {
    const next = attachTimingAverages(normalizeUsageSnapshot(snapshot), emptyTimingAgg())
    this.perThread.set(threadId, next)
    this.dirtyThreads.delete(threadId)
    // Restored threads have no in-process timing history.
    this.timing.delete(threadId)
    return next
  }

  /**
   * Fold a usage snapshot into the per-thread counter. When the
   * provider does not report cache metrics, `cacheHitRate` is
   * preserved as `null` to signal "unknown".
   */
  record(threadId: string, snapshot: UsageSnapshot): UsageSnapshot {
    const current = this.perThread.get(threadId) ?? emptyUsageSnapshot()
    const promptTokens = current.promptTokens + snapshot.promptTokens
    const completionTokens = current.completionTokens + snapshot.completionTokens
    const reasoningTokens = sumOptional(current.reasoningTokens, snapshot.reasoningTokens)
    const totalTokens = promptTokens + completionTokens
    const cachedTokens =
      (current.cachedTokens ?? 0) + (snapshot.cachedTokens ?? 0)
    const cacheHitTokens =
      (current.cacheHitTokens ?? 0) + (snapshot.cacheHitTokens ?? 0)
    const cacheMissTokens =
      (current.cacheMissTokens ?? 0) + (snapshot.cacheMissTokens ?? 0)
    const cacheWriteTokens = sumOptional(current.cacheWriteTokens, snapshot.cacheWriteTokens)
    const cacheTotal = cacheHitTokens + cacheMissTokens
    const cacheHitRate =
      cacheTotal === 0
        ? null
        : cacheHitTokens / cacheTotal
    const turns = current.turns + (snapshot.turns > 0 ? snapshot.turns : 1)
    const costUsd =
      current.costUsd === undefined && snapshot.costUsd === undefined
        ? undefined
        : (current.costUsd ?? 0) + (snapshot.costUsd ?? 0)
    const costCny =
      current.costCny === undefined && snapshot.costCny === undefined
        ? undefined
        : (current.costCny ?? 0) + (snapshot.costCny ?? 0)
    const costByCurrency = mergeCurrencyCosts(current.costByCurrency, snapshot.costByCurrency)
    const cacheSavingsUsd =
      current.cacheSavingsUsd === undefined && snapshot.cacheSavingsUsd === undefined
        ? undefined
        : (current.cacheSavingsUsd ?? 0) + (snapshot.cacheSavingsUsd ?? 0)
    const cacheSavingsCny =
      current.cacheSavingsCny === undefined && snapshot.cacheSavingsCny === undefined
        ? undefined
        : (current.cacheSavingsCny ?? 0) + (snapshot.cacheSavingsCny ?? 0)
    const tokenEconomySavingsTokens =
      (current.tokenEconomySavingsTokens ?? 0) + (snapshot.tokenEconomySavingsTokens ?? 0)
    const tokenEconomySavingsUsd =
      current.tokenEconomySavingsUsd === undefined && snapshot.tokenEconomySavingsUsd === undefined
        ? undefined
        : (current.tokenEconomySavingsUsd ?? 0) + (snapshot.tokenEconomySavingsUsd ?? 0)
    const tokenEconomySavingsCny =
      current.tokenEconomySavingsCny === undefined && snapshot.tokenEconomySavingsCny === undefined
        ? undefined
        : (current.tokenEconomySavingsCny ?? 0) + (snapshot.tokenEconomySavingsCny ?? 0)
    const carryAttribution = !hasModelRequestUsage(snapshot)
    const actualProviderId = attributionText(snapshot.actualProviderId, current.actualProviderId, carryAttribution)
    const actualModelId = attributionText(snapshot.actualModelId, current.actualModelId, carryAttribution)
    const requestedModelId = attributionText(snapshot.requestedModelId, current.requestedModelId, carryAttribution)
    const routePoolId = attributionText(snapshot.routePoolId, current.routePoolId, carryAttribution)
    const routeTargetId = attributionText(snapshot.routeTargetId, current.routeTargetId, carryAttribution)
    const billingKind = snapshot.billingKind ?? (carryAttribution ? current.billingKind : undefined)
    const serviceTier = snapshot.serviceTier ?? (carryAttribution ? current.serviceTier : undefined)
    const next: UsageSnapshot = {
      promptTokens,
      completionTokens,
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
      totalTokens,
      cachedTokens,
      cacheHitTokens,
      cacheMissTokens,
      ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
      cacheHitRate,
      cacheableTokenHitRate: snapshot.cacheableTokenHitRate,
      totalInputTokenHitRate: snapshot.totalInputTokenHitRate,
      cacheMissReasons: snapshot.cacheMissReasons,
      cacheSuggestions: snapshot.cacheSuggestions,
      ...(actualProviderId ? { actualProviderId } : {}),
      ...(actualModelId ? { actualModelId } : {}),
      ...(billingKind ? { billingKind } : {}),
      ...(serviceTier ? { serviceTier } : {}),
      ...(requestedModelId ? { requestedModelId } : {}),
      ...(routePoolId ? { routePoolId } : {}),
      ...(routeTargetId ? { routeTargetId } : {}),
      turns,
      costUsd,
      costCny,
      ...(costByCurrency ? { costByCurrency } : {}),
      cacheSavingsUsd,
      cacheSavingsCny,
      tokenEconomySavingsTokens,
      tokenEconomySavingsUsd,
      tokenEconomySavingsCny,
      hasError: snapshot.hasError
    }
    const threadTiming = this.timing.get(threadId) ?? emptyTimingAgg()
    this.timing.set(threadId, foldTiming(threadTiming, snapshot))
    this.perThread.set(threadId, attachTimingAverages(next, this.timing.get(threadId)!))
    this.dirtyThreads.add(threadId)
    return this.perThread.get(threadId)!
  }

  recordTokenEconomySavings(
    threadId: string,
    savings: Pick<
      UsageSnapshot,
      'tokenEconomySavingsTokens' | 'tokenEconomySavingsUsd' | 'tokenEconomySavingsCny'
    >
  ): UsageSnapshot {
    const current = this.perThread.get(threadId) ?? emptyUsageSnapshot()
    const next: UsageSnapshot = {
      ...current,
      tokenEconomySavingsTokens:
        (current.tokenEconomySavingsTokens ?? 0) + (savings.tokenEconomySavingsTokens ?? 0),
      tokenEconomySavingsUsd:
        current.tokenEconomySavingsUsd === undefined && savings.tokenEconomySavingsUsd === undefined
          ? undefined
          : (current.tokenEconomySavingsUsd ?? 0) + (savings.tokenEconomySavingsUsd ?? 0),
      tokenEconomySavingsCny:
        current.tokenEconomySavingsCny === undefined && savings.tokenEconomySavingsCny === undefined
          ? undefined
          : (current.tokenEconomySavingsCny ?? 0) + (savings.tokenEconomySavingsCny ?? 0)
    }
    this.perThread.set(threadId, next)
    this.dirtyThreads.add(threadId)
    return next
  }

  total(): UsageSnapshot {
    const totals = [...this.perThread.values()].reduce((acc, snapshot) => {
      return mergeUsage(acc, snapshot)
    }, emptyUsageSnapshot())
    const timing = aggregateTiming([...this.timing.values()])
    return attachTimingAverages(totals, timing)
  }

  forThread(threadId: string): UsageSnapshot {
    return this.perThread.get(threadId) ?? emptyUsageSnapshot()
  }

  snapshots(): Array<{ threadId: string; usage: UsageSnapshot }> {
    return [...this.dirtyThreads].map((threadId) => ({
      threadId,
      usage: this.perThread.get(threadId) ?? emptyUsageSnapshot()
    }))
  }
}

type TimingAgg = {
  ttftSumMs: number
  generationSumMs: number
  completionTokensSum: number
  ttftCalls: number
  tpsCalls: number
}

function emptyTimingAgg(): TimingAgg {
  return {
    ttftSumMs: 0,
    generationSumMs: 0,
    completionTokensSum: 0,
    ttftCalls: 0,
    tpsCalls: 0
  }
}

/** Fold one request's timing fields into the thread aggregate. */
function foldTiming(agg: TimingAgg, snapshot: UsageSnapshot): TimingAgg {
  const ttft = snapshot.requestTtftMs
  if (typeof ttft === 'number' && Number.isFinite(ttft) && ttft >= 0) {
    agg.ttftSumMs += ttft
    agg.ttftCalls += 1
  }
  const generation = snapshot.requestGenerationMs
  if (
    typeof generation === 'number' &&
    Number.isFinite(generation) &&
    generation >= 0 &&
    snapshot.completionTokens > 0
  ) {
    agg.generationSumMs += generation
    agg.completionTokensSum += snapshot.completionTokens
    agg.tpsCalls += 1
  }
  return agg
}

function aggregateTiming(items: readonly TimingAgg[]): TimingAgg {
  const agg = emptyTimingAgg()
  for (const item of items) {
    agg.ttftSumMs += item.ttftSumMs
    agg.generationSumMs += item.generationSumMs
    agg.completionTokensSum += item.completionTokensSum
    agg.ttftCalls += item.ttftCalls
    agg.tpsCalls += item.tpsCalls
  }
  return agg
}

/**
 * Attach thread-cumulative averages to a snapshot. TTFT is a simple mean
 * over timed requests; tokens-per-second is a weighted mean computed from
 * total generated tokens divided by total generation time.
 */
function attachTimingAverages(snapshot: UsageSnapshot, timing: TimingAgg): UsageSnapshot {
  return {
    ...snapshot,
    avgTtftMs: timing.ttftCalls > 0 ? timing.ttftSumMs / timing.ttftCalls : null,
    avgTokensPerSecond:
      timing.generationSumMs > 0
        ? (timing.completionTokensSum / timing.generationSumMs) * 1_000
        : null
  }
}

function normalizeUsageSnapshot(snapshot: UsageSnapshot): UsageSnapshot {
  const promptTokens = Math.max(0, Math.floor(snapshot.promptTokens))
  const completionTokens = Math.max(0, Math.floor(snapshot.completionTokens))
  const reasoningTokens = snapshot.reasoningTokens !== undefined
    ? Math.max(0, Math.floor(snapshot.reasoningTokens))
    : undefined
  const totalTokens = Math.max(0, Math.floor(snapshot.totalTokens || promptTokens + completionTokens))
  const cachedTokens = snapshot.cachedTokens !== undefined
    ? Math.max(0, Math.floor(snapshot.cachedTokens))
    : undefined
  const cacheHitTokens = snapshot.cacheHitTokens !== undefined
    ? Math.max(0, Math.floor(snapshot.cacheHitTokens))
    : undefined
  const cacheMissTokens = snapshot.cacheMissTokens !== undefined
    ? Math.max(0, Math.floor(snapshot.cacheMissTokens))
    : undefined
  const cacheWriteTokens = snapshot.cacheWriteTokens !== undefined
    ? Math.max(0, Math.floor(snapshot.cacheWriteTokens))
    : undefined
  const cacheTotal = (cacheHitTokens ?? 0) + (cacheMissTokens ?? 0)
  return {
    promptTokens,
    completionTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    totalTokens,
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(cacheHitTokens !== undefined ? { cacheHitTokens } : {}),
    ...(cacheMissTokens !== undefined ? { cacheMissTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    cacheHitRate: cacheHitTokens !== undefined && cacheTotal > 0 ? cacheHitTokens / cacheTotal : null,
    ...(snapshot.cacheableTokenHitRate !== undefined
      ? { cacheableTokenHitRate: snapshot.cacheableTokenHitRate }
      : {}),
    ...(snapshot.totalInputTokenHitRate !== undefined
      ? { totalInputTokenHitRate: snapshot.totalInputTokenHitRate }
      : {}),
    ...(snapshot.cacheMissReasons ? { cacheMissReasons: [...snapshot.cacheMissReasons] } : {}),
    ...(snapshot.cacheSuggestions ? { cacheSuggestions: [...snapshot.cacheSuggestions] } : {}),
    ...(snapshot.actualProviderId ? { actualProviderId: snapshot.actualProviderId } : {}),
    ...(snapshot.actualModelId ? { actualModelId: snapshot.actualModelId } : {}),
    ...(snapshot.billingKind ? { billingKind: snapshot.billingKind } : {}),
    ...(snapshot.serviceTier ? { serviceTier: snapshot.serviceTier } : {}),
    ...(snapshot.requestedModelId ? { requestedModelId: snapshot.requestedModelId } : {}),
    ...(snapshot.routePoolId ? { routePoolId: snapshot.routePoolId } : {}),
    ...(snapshot.routeTargetId ? { routeTargetId: snapshot.routeTargetId } : {}),
    turns: Math.max(0, Math.floor(snapshot.turns)),
    ...(snapshot.costUsd !== undefined ? { costUsd: Math.max(0, snapshot.costUsd) } : {}),
    ...(snapshot.costCny !== undefined ? { costCny: Math.max(0, snapshot.costCny) } : {}),
    ...(snapshot.costByCurrency ? {
      costByCurrency: Object.fromEntries(Object.entries(snapshot.costByCurrency)
        .map(([currency, cost]) => [currency, Math.max(0, cost)]))
    } : {}),
    ...(snapshot.cacheSavingsUsd !== undefined ? { cacheSavingsUsd: Math.max(0, snapshot.cacheSavingsUsd) } : {}),
    ...(snapshot.cacheSavingsCny !== undefined ? { cacheSavingsCny: Math.max(0, snapshot.cacheSavingsCny) } : {}),
    ...(snapshot.tokenEconomySavingsTokens !== undefined
      ? { tokenEconomySavingsTokens: Math.max(0, Math.floor(snapshot.tokenEconomySavingsTokens)) }
      : {}),
    ...(snapshot.tokenEconomySavingsUsd !== undefined
      ? { tokenEconomySavingsUsd: Math.max(0, snapshot.tokenEconomySavingsUsd) }
      : {}),
    ...(snapshot.tokenEconomySavingsCny !== undefined
      ? { tokenEconomySavingsCny: Math.max(0, snapshot.tokenEconomySavingsCny) }
      : {}),
    ...(snapshot.hasError ? { hasError: true } : {})
  }
}

function mergeUsage(into: UsageSnapshot, delta: UsageSnapshot): UsageSnapshot {
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
    cacheTotal === 0 ? null : cacheHitTokens / cacheTotal
  // Union diagnostic string arrays across all folded threads instead of
  // dropping them from the cross-thread aggregate.
  const cacheMissReasons = unionStrings(into.cacheMissReasons, delta.cacheMissReasons)
  const cacheSuggestions = unionStrings(into.cacheSuggestions, delta.cacheSuggestions)
  // Per-turn hit rates are not additive across threads; recompute from the
  // aggregated token counts when telemetry exists, else leave unset.
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

function sumOptional(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0)
}

function attributionText(
  latest: string | undefined,
  previous: string | undefined,
  carryPrevious: boolean
): string | undefined {
  return latest?.trim() || (carryPrevious ? previous?.trim() : undefined) || undefined
}

function hasModelRequestUsage(snapshot: UsageSnapshot): boolean {
  return snapshot.turns > 0 || snapshot.promptTokens > 0 ||
    snapshot.completionTokens > 0 || snapshot.totalTokens > 0
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
 * seen order. Returns `undefined` when neither side carried any values.
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
