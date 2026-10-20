import type { UsageEvent } from '../contracts/events.js'
import type { ThreadUsageBucket } from '../contracts/usage.js'

/** Average time to first token and generation speed of one turn's model calls. */
export type TurnTiming = {
  avgTtftMs: number | null
  avgTokensPerSecond: number | null
}

/** Thread totals for the sidebar's Usage before this session sees a usage event. */
export type ThreadUsageSummary = {
  costUsd: number
  costCny: number
  cacheHitRate: number | null
  avgTtftMs: number | null
  avgTokensPerSecond: number | null
}

/** The thread's row of `/v1/usage?group_by=thread`, in the live snapshot's terms. */
export function threadUsageSummary(bucket: ThreadUsageBucket): ThreadUsageSummary {
  return {
    costUsd: bucket.cost_usd,
    costCny: bucket.cost_cny,
    cacheHitRate: bucket.cache_hit_rate,
    avgTtftMs: finiteOrNull(bucket.avg_ttft_ms),
    avgTokensPerSecond: finiteOrNull(bucket.avg_tokens_per_second)
  }
}

/** The live per-turn averages a parent usage event carries, if any. */
export function turnTimingFromUsageEvent(event: UsageEvent): { turnId: string; timing: TurnTiming } | undefined {
  if (!event.turnId || event.child) return undefined
  if (event.attribution && event.attribution !== 'agent-turn') return undefined
  const timing: TurnTiming = {
    avgTtftMs: finiteOrNull(event.usage.turnAvgTtftMs),
    avgTokensPerSecond: finiteOrNull(event.usage.turnAvgTokensPerSecond)
  }
  return hasTurnTiming(timing) ? { turnId: event.turnId, timing } : undefined
}

export function hasTurnTiming(timing: TurnTiming | undefined): timing is TurnTiming {
  return Boolean(timing && (timing.avgTtftMs !== null || timing.avgTokensPerSecond !== null))
}

/** "0.6s", or undefined without data (legacy turns show nothing). */
export function formatTtft(value: number | null | undefined): string | undefined {
  const finite = finiteOrNull(value)
  return finite === null ? undefined : `${(finite / 1_000).toFixed(1)}s`
}

/** "52.4", or undefined without data. */
export function formatTokensPerSecond(value: number | null | undefined): string | undefined {
  const finite = finiteOrNull(value)
  return finite === null ? undefined : finite.toFixed(1)
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** "TTFT 0.6s · 52.4 tok/s" pieces; a missing measurement drops its piece. */
export function turnTimingParts(timing: TurnTiming | undefined): { label: string; value: string; unit?: string }[] {
  if (!timing) return []
  const ttft = formatTtft(timing.avgTtftMs)
  const tps = formatTokensPerSecond(timing.avgTokensPerSecond)
  return [
    ...(ttft ? [{ label: 'TTFT', value: ttft }] : []),
    ...(tps ? [{ label: '', value: tps, unit: 'tok/s' }] : [])
  ]
}
