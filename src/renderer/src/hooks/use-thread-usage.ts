import { useEffect, useState } from 'react'

export type ThreadUsageSummary = {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheMissTokens: number
  cacheHitRate: number | null
  totalTokens: number
  costUsd: number
  turns: number
}

export type ThreadUsageState = {
  usage: ThreadUsageSummary | null
  loading: boolean
  loaded: boolean
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function hasFiniteNumber(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'number' && Number.isFinite(record[key])
}

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return new Intl.NumberFormat().format(value)
}

export function formatCost(value: number): string {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`
}

export function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-'
  const percent = Math.max(0, Math.min(100, value * 100))
  if (percent === 0 || percent >= 10) return `${Math.round(percent)}%`
  return `${percent.toFixed(1)}%`
}

type CacheStats = {
  hitTokens: number
  missTokens: number
}

async function loadThreadCacheStats(threadId: string): Promise<CacheStats | null> {
  if (typeof window.dsGui?.runtimeRequest !== 'function') return null
  const r = await window.dsGui.runtimeRequest(
    `/v1/threads/${encodeURIComponent(threadId)}`,
    'GET'
  )
  if (!r.ok || !r.body.trim()) return null
  const parsed = JSON.parse(r.body) as {
    turns?: Array<{ usage?: Record<string, unknown> | null }>
  }
  let hitTokens = 0
  let missTokens = 0
  let hasCacheTelemetry = false

  for (const turn of parsed.turns ?? []) {
    const usage = turn.usage
    if (!usage || typeof usage !== 'object') continue
    const hasHit = hasFiniteNumber(usage, 'prompt_cache_hit_tokens')
    const hasMiss = hasFiniteNumber(usage, 'prompt_cache_miss_tokens')
    if (!hasHit && !hasMiss) continue
    hasCacheTelemetry = true
    const hit = usageNumber(usage.prompt_cache_hit_tokens)
    const miss = hasMiss
      ? usageNumber(usage.prompt_cache_miss_tokens)
      : Math.max(usageNumber(usage.input_tokens) - hit, 0)
    hitTokens += hit
    missTokens += miss
  }

  return hasCacheTelemetry ? { hitTokens, missTokens } : null
}

export async function loadThreadUsage(threadId: string): Promise<ThreadUsageSummary | null> {
  if (typeof window.dsGui?.runtimeRequest !== 'function') return null
  const [r, cacheStats] = await Promise.all([
    window.dsGui.runtimeRequest('/v1/usage?group_by=thread', 'GET'),
    loadThreadCacheStats(threadId).catch(() => null)
  ])
  if (!r.ok || !r.body.trim()) return null
  const parsed = JSON.parse(r.body) as {
    buckets?: Array<Record<string, unknown>>
  }
  const bucket = parsed.buckets?.find((item) => {
    const candidates = [item.thread_id, item.key, item.id, item.label]
    return candidates.some((candidate) => candidate === threadId)
  })
  if (!bucket) return null
  const inputTokens = usageNumber(bucket.input_tokens)
  const outputTokens = usageNumber(bucket.output_tokens)
  const reasoningTokens = usageNumber(bucket.reasoning_tokens)
  const cachedTokens = cacheStats?.hitTokens ?? usageNumber(bucket.cached_tokens)
  const cacheMissTokens = cacheStats?.missTokens ?? Math.max(inputTokens - cachedTokens, 0)
  const cacheTotal = cachedTokens + cacheMissTokens
  const cacheHitRate =
    cacheTotal > 0
      ? cachedTokens / cacheTotal
      : inputTokens > 0
        ? cachedTokens / inputTokens
        : null
  const totalTokens = inputTokens + outputTokens
  const costUsd = usageNumber(bucket.cost_usd)
  const turns = usageNumber(bucket.turns)
  if (totalTokens <= 0 && cachedTokens <= 0 && costUsd <= 0 && turns <= 0) return null
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedTokens,
    cacheMissTokens,
    cacheHitRate,
    totalTokens,
    costUsd,
    turns
  }
}

export function useThreadUsageState(
  threadId: string | null | undefined,
  enabled: boolean,
  refreshKey: unknown
): ThreadUsageState {
  const [state, setState] = useState<ThreadUsageState>({
    usage: null,
    loading: false,
    loaded: false
  })

  useEffect(() => {
    let cancelled = false
    if (!threadId || !enabled) {
      setState({ usage: null, loading: false, loaded: false })
      return
    }
    setState((current) => ({ ...current, loading: true }))
    void loadThreadUsage(threadId)
      .then((usage) => {
        if (!cancelled) setState({ usage, loading: false, loaded: true })
      })
      .catch(() => {
        if (!cancelled) setState({ usage: null, loading: false, loaded: true })
      })
    return () => {
      cancelled = true
    }
  }, [enabled, refreshKey, threadId])

  return state
}

export function useThreadUsage(
  threadId: string | null | undefined,
  enabled: boolean,
  refreshKey: unknown
): ThreadUsageSummary | null {
  return useThreadUsageState(threadId, enabled, refreshKey).usage
}
