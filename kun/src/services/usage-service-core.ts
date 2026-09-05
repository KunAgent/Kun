import { UsageCounter } from '../telemetry/usage-counter.js'
import { CacheTelemetry } from '../telemetry/cache-telemetry.js'
import {
  diagnoseCacheUsage,
  type CacheRequestSignature
} from '../cache/cache-diagnostics.js'
import { analyzeCacheRegression, cacheRegressionSeverityRank } from '../cache/cache-regression.js'
import type {
  DailyUsageBucket,
  DailyUsageCounters,
  DailyUsageResponse,
  ModelUsageBucket,
  ModelUsageResponse,
  ThreadUsageBucket,
  ThreadUsageResponse,
  UsageSnapshot
} from '../contracts/usage.js'

/**
 * Coordinates usage and cache telemetry. The service records each
 * model response and returns the cumulative snapshot for the loop to
 * forward as a `usage` runtime event.
 */
export class UsageService {
  private readonly counter = new UsageCounter()
  private readonly cache = new CacheTelemetry()
  private readonly cacheSignatures = new Map<string, CacheRequestSignature>()
  /** Raw per-request timing sums keyed by `threadId::turnId`. */
  private readonly turnTiming = new Map<string, TurnTiming>()
  /**
   * Rolling cacheable-hit-rate history keyed by thread + provider/model/endpoint
   * so a model or provider switch starts a FRESH baseline instead of polluting
   * the previous one. Cold-start and outliers are absorbed by the analyzer's
   * median baseline.
   */
  private readonly cacheHitHistory = new Map<string, number[]>()
  /**
   * Cooldown state per history key so one regression isn't re-announced every
   * turn: we only re-emit when the cooldown window elapses or severity worsens.
   */
  private readonly cacheRegressionCooldown = new Map<string, { severityRank: number; turnsSinceEmit: number }>()

  record(
    threadId: string,
    usage: UsageSnapshot,
    signature?: CacheRequestSignature,
    turnId?: string
  ): UsageSnapshot {
    const enriched = signature ? this.withCacheDiagnostics(threadId, usage, signature) : usage
    this.cache.ingest(threadId, enriched)
    const cumulative = this.counter.record(threadId, enriched)
    const withLastRequest = {
      ...cumulative,
      lastRequestCacheHitRate: enriched.cacheHitRate ?? null
    }
    if (turnId) {
      return attachTurnAverages(withLastRequest, this.foldTurnTiming(threadId, turnId, enriched))
    }
    return withLastRequest
  }

  recordTokenEconomySavings(
    threadId: string,
    savings: Pick<
      UsageSnapshot,
      'tokenEconomySavingsTokens' | 'tokenEconomySavingsUsd' | 'tokenEconomySavingsCny'
    >
  ): UsageSnapshot {
    return this.counter.recordTokenEconomySavings(threadId, savings)
  }

  seedThread(threadId: string, usage: UsageSnapshot): UsageSnapshot {
    const seeded = this.counter.seed(threadId, usage)
    this.cache.reset(threadId)
    this.cache.ingest(threadId, seeded)
    this.cacheSignatures.delete(threadId)
    this.clearCacheHistory(threadId)
    this.clearTurnTiming(threadId)
    return seeded
  }

  forThread(threadId: string): UsageSnapshot {
    return this.counter.forThread(threadId)
  }

  snapshots(): Array<{ threadId: string; usage: UsageSnapshot }> {
    return this.counter.snapshots()
  }

  total(): UsageSnapshot {
    return this.counter.total()
  }

  cacheSnapshot(threadId: string) {
    return this.cache.snapshot(threadId)
  }

  reset(threadId?: string): void {
    this.counter.reset(threadId)
    this.cache.reset(threadId)
    if (threadId === undefined) {
      this.cacheSignatures.clear()
    } else {
      this.cacheSignatures.delete(threadId)
    }
    if (threadId === undefined) {
      this.cacheHitHistory.clear()
      this.cacheRegressionCooldown.clear()
    } else {
      this.clearCacheHistory(threadId)
    }
    this.clearTurnTiming(threadId)
  }

  /**
   * Drop per-turn timing for a finished turn so long-lived threads do not
   * accumulate one entry per historical turn. Call when the turn settles.
   */
  endTurn(threadId: string, turnId: string): void {
    this.turnTiming.delete(this.turnKey(threadId, turnId))
  }

  private turnKey(threadId: string, turnId: string): string {
    return `${threadId}::${turnId}`
  }

  private clearTurnTiming(threadId?: string): void {
    if (threadId === undefined) {
      this.turnTiming.clear()
      return
    }
    const prefix = `${threadId}::`
    for (const key of this.turnTiming.keys()) {
      if (key.startsWith(prefix)) this.turnTiming.delete(key)
    }
  }

  private foldTurnTiming(threadId: string, turnId: string, snapshot: UsageSnapshot): TurnTiming {
    const key = this.turnKey(threadId, turnId)
    const agg = this.turnTiming.get(key) ?? emptyTurnTiming()
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
    this.turnTiming.set(key, agg)
    return agg
  }

  /** Drop all signature-keyed cache history + cooldown rows for one thread. */
  private clearCacheHistory(threadId: string): void {
    const prefix = `${threadId}::`
    for (const key of this.cacheHitHistory.keys()) {
      if (key === threadId || key.startsWith(prefix)) this.cacheHitHistory.delete(key)
    }
    for (const key of this.cacheRegressionCooldown.keys()) {
      if (key === threadId || key.startsWith(prefix)) this.cacheRegressionCooldown.delete(key)
    }
  }

  private withCacheDiagnostics(
    threadId: string,
    usage: UsageSnapshot,
    signature: CacheRequestSignature
  ): UsageSnapshot {
    const diagnostic = diagnoseCacheUsage({
      usage,
      previous: this.cacheSignatures.get(threadId),
      current: signature
    })
    this.cacheSignatures.set(threadId, {
      ...signature,
      activeSkillIds: [...signature.activeSkillIds]
    })
    // Trend-based regression: compare this turn's cacheable hit rate against
    // the thread's recent baseline FOR THE SAME provider/model/endpoint so we
    // can explain a *drop* (not just the per-turn miss reasons). A cooldown
    // stops the same regression from being re-announced every turn.
    const historyKey = cacheHistoryKey(threadId, signature)
    const history = this.cacheHitHistory.get(historyKey) ?? []
    const regression = analyzeCacheRegression({
      current: diagnostic.cacheableTokenHitRate,
      baseline: history,
      reasons: diagnostic.reasons,
      minBaselineSamples: 2
    })
    const cooldown = this.cacheRegressionCooldown.get(historyKey) ?? { severityRank: 0, turnsSinceEmit: CACHE_REGRESSION_COOLDOWN_TURNS }
    cooldown.turnsSinceEmit += 1
    const severityRank = cacheRegressionSeverityRank(regression.severity)
    const shouldAnnounce = Boolean(regression.explanation) && (
      cooldown.turnsSinceEmit >= CACHE_REGRESSION_COOLDOWN_TURNS || severityRank > cooldown.severityRank
    )
    const suggestions = shouldAnnounce && regression.explanation
      ? [regression.explanation, ...diagnostic.suggestions]
      : diagnostic.suggestions
    if (shouldAnnounce) {
      this.cacheRegressionCooldown.set(historyKey, { severityRank, turnsSinceEmit: 0 })
    } else if (regression.severity === 'none') {
      // Recovered — clear cooldown so the next genuine drop is announced promptly.
      this.cacheRegressionCooldown.set(historyKey, { severityRank: 0, turnsSinceEmit: cooldown.turnsSinceEmit })
    } else {
      this.cacheRegressionCooldown.set(historyKey, cooldown)
    }
    if (typeof diagnostic.cacheableTokenHitRate === 'number') {
      this.cacheHitHistory.set(historyKey, [...history, diagnostic.cacheableTokenHitRate].slice(-CACHE_HIT_HISTORY_LIMIT))
    }
    return {
      ...usage,
      cacheableTokenHitRate: diagnostic.cacheableTokenHitRate,
      totalInputTokenHitRate: diagnostic.totalInputTokenHitRate,
      cacheMissReasons: diagnostic.reasons,
      cacheSuggestions: [...new Set(suggestions)]
    }
  }
}

export type TurnTiming = {
  ttftSumMs: number
  generationSumMs: number
  completionTokensSum: number
  ttftCalls: number
  tpsCalls: number
}

export function emptyTurnTiming(): TurnTiming {
  return {
    ttftSumMs: 0,
    generationSumMs: 0,
    completionTokensSum: 0,
    ttftCalls: 0,
    tpsCalls: 0
  }
}

/**
 * Attach this turn's averages to the cumulative snapshot. TTFT is a simple
 * mean; tokens-per-second is weighted by total generated tokens over total
 * generation time.
 */
export function attachTurnAverages(snapshot: UsageSnapshot, timing: TurnTiming): UsageSnapshot {
  return {
    ...snapshot,
    turnAvgTtftMs: timing.ttftCalls > 0 ? timing.ttftSumMs / timing.ttftCalls : null,
    turnAvgTokensPerSecond:
      timing.generationSumMs > 0
        ? (timing.completionTokensSum / timing.generationSumMs) * 1_000
        : null
  }
}

export const MAX_DAILY_USAGE_DAYS = 370

/** Rolling window of recent cacheable-hit-rate samples kept per thread. */
export const CACHE_HIT_HISTORY_LIMIT = 20

/** Turns to wait before re-announcing the same cache regression severity. */
export const CACHE_REGRESSION_COOLDOWN_TURNS = 5

/**
 * History/cooldown key: per thread AND per provider/model/endpoint so a model
 * or provider switch starts a fresh baseline instead of polluting the prior
 * one. The prefix fingerprint is intentionally excluded — a prefix change is a
 * regression *cause* we want to detect, not a reason to reset the baseline.
 */
export function cacheHistoryKey(threadId: string, signature: CacheRequestSignature): string {
  return [
    threadId,
    signature.providerId,
    signature.model,
    signature.endpointFormat,
    signature.partitionHash ?? 'legacy'
  ].join('::')
}
