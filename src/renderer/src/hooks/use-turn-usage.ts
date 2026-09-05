import { useEffect, useRef, useState } from 'react'
import { requestUsage } from './usage-request-cache'
import { parseUsageResponse } from './usage-response'

const TURN_USAGE_RETRY_DELAYS_MS = [250, 750] as const
const TURN_USAGE_REFRESH_DEBOUNCE_MS = 150

export type TurnUsageActualCost = {
  currency: string
  amount: number
}

export type TurnUsageReferencePriceItem = {
  kind: 'uncached_input' | 'cache_read' | 'cache_write' | 'output'
  tokens: number
  ratePerMillion: number
  amount: number
}

export type TurnUsageReferencePriceGroup = {
  model: string
  pricingMode: 'standard' | 'fast' | 'long_context'
  requestCount: number
  fastMultiplier: number | null
  amount: number
  items: TurnUsageReferencePriceItem[]
}

export type TurnUsageReferencePriceBreakdown = {
  currency: 'USD'
  amount: number
  pricedRequests: number
  unpricedRequests: number
  groups: TurnUsageReferencePriceGroup[]
}

export type TurnUsageSummary = {
  turnId: string
  requests: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheWriteTokens: number
  totalTokens: number
  actualCost: TurnUsageActualCost | null
  referenceEstimateUsd: number | null
  referencePriceBreakdown: TurnUsageReferencePriceBreakdown | null
  estimateCoverage: 'complete' | 'partial' | 'unavailable'
  providerIds: string[]
  models: string[]
}

export type TurnUsageState = {
  byTurnId: ReadonlyMap<string, TurnUsageSummary>
  loading: boolean
  loaded: boolean
  stale: boolean
}

export async function loadTurnUsage(
  threadId: string,
  generation?: string | number
): Promise<ReadonlyMap<string, TurnUsageSummary>> {
  if (typeof window.kunGui?.runtimeRequest !== 'function') return new Map()
  const params = new URLSearchParams({
    group_by: 'turn',
    thread_id: threadId
  })
  const response = await requestUsage(
    `/v1/usage?${params.toString()}`,
    'turn usage',
    generation
  )
  if (!response.ok) {
    throw new Error(`Turn usage request failed (HTTP ${response.status}).`)
  }
  return parseTurnUsageResponse(response.body, threadId)
}

export function parseTurnUsageResponse(
  body: string,
  threadId: string
): ReadonlyMap<string, TurnUsageSummary> {
  const payload = parseUsageResponse<{
    group_by?: unknown
    thread_id?: unknown
    buckets?: unknown
  }>(body, 'turn usage')
  if (payload.group_by !== 'turn' || payload.thread_id !== threadId || !Array.isArray(payload.buckets)) {
    throw new Error('Kun returned invalid turn usage data.')
  }
  const byTurnId = new Map<string, TurnUsageSummary>()
  for (const value of payload.buckets) {
    if (!isRecord(value)) continue
    const turnId = stringValue(value.turn_id)
    const coverage = coverageValue(value.estimate_coverage)
    if (!turnId || !coverage) continue
    const inputTokens = countValue(value.input_tokens)
    const outputTokens = countValue(value.output_tokens)
    const reportedTotal = countValue(value.total_tokens)
    const actualCost = parseActualCost(value.actual_cost)
    const referenceEstimateUsd = nullableAmount(value.reference_estimate_usd)
    const referencePriceBreakdown = parseReferencePriceBreakdown(value.reference_price_breakdown)
    byTurnId.set(turnId, {
      turnId,
      requests: countValue(value.requests),
      inputTokens,
      outputTokens,
      reasoningTokens: countValue(value.reasoning_tokens),
      cachedTokens: countValue(value.cached_tokens),
      cacheWriteTokens: countValue(value.cache_write_tokens),
      totalTokens: reportedTotal || inputTokens + outputTokens,
      actualCost,
      referenceEstimateUsd,
      referencePriceBreakdown,
      estimateCoverage: coverage,
      providerIds: stringArray(value.provider_ids),
      models: stringArray(value.models)
    })
  }
  return byTurnId
}

function parseReferencePriceBreakdown(value: unknown): TurnUsageReferencePriceBreakdown | null {
  if (!isRecord(value) || value.currency !== 'USD' || !Array.isArray(value.groups)) return null
  const amount = nullableAmount(value.amount)
  if (amount === null) return null
  const groups = value.groups.flatMap(parseReferencePriceGroup)
  return {
    currency: 'USD',
    amount,
    pricedRequests: countValue(value.priced_requests),
    unpricedRequests: countValue(value.unpriced_requests),
    groups
  }
}

function parseReferencePriceGroup(value: unknown): TurnUsageReferencePriceGroup[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return []
  const model = stringValue(value.model)
  const pricingMode = pricingModeValue(value.pricing_mode)
  const amount = nullableAmount(value.amount)
  if (!model || !pricingMode || amount === null) return []
  return [{
    model,
    pricingMode,
    requestCount: countValue(value.request_count),
    fastMultiplier: nullablePositiveAmount(value.fast_multiplier),
    amount,
    items: value.items.flatMap(parseReferencePriceItem)
  }]
}

function parseReferencePriceItem(value: unknown): TurnUsageReferencePriceItem[] {
  if (!isRecord(value)) return []
  const kind = priceItemKindValue(value.kind)
  const ratePerMillion = nullableAmount(value.rate_per_million)
  const amount = nullableAmount(value.amount)
  if (!kind || ratePerMillion === null || amount === null) return []
  return [{ kind, tokens: countValue(value.tokens), ratePerMillion, amount }]
}

export function useTurnUsageState(
  threadId: string | null | undefined,
  refreshKey: unknown
): TurnUsageState {
  const activeThreadRef = useRef<string | null>(null)
  const [state, setState] = useState<TurnUsageState>({
    byTurnId: new Map(),
    loading: false,
    loaded: false,
    stale: false
  })

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const nextThreadId = threadId ?? null
    const changed = activeThreadRef.current !== nextThreadId
    activeThreadRef.current = nextThreadId
    if (!threadId) {
      setState({ byTurnId: new Map(), loading: false, loaded: false, stale: false })
      return
    }
    setState((current) => changed
      ? { byTurnId: new Map(), loading: true, loaded: false, stale: false }
      : { ...current, loading: true })

    const load = (attempt: number): void => {
      void loadTurnUsage(threadId, String(refreshKey)).then((byTurnId) => {
        if (cancelled) return
        setState({ byTurnId, loading: false, loaded: true, stale: false })
      }).catch(() => {
        if (cancelled) return
        const delay = TURN_USAGE_RETRY_DELAYS_MS[attempt]
        if (delay !== undefined) {
          retryTimer = setTimeout(() => load(attempt + 1), delay)
          return
        }
        setState((current) => ({
          ...current,
          loading: false,
          loaded: current.loaded,
          stale: current.byTurnId.size > 0
        }))
      })
    }
    if (changed) load(0)
    else retryTimer = setTimeout(() => load(0), TURN_USAGE_REFRESH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [refreshKey, threadId])

  return state
}

function parseActualCost(value: unknown): TurnUsageActualCost | null {
  if (!isRecord(value)) return null
  const currency = stringValue(value.currency).toUpperCase()
  const amount = nullableAmount(value.amount)
  return /^[A-Z]{3}$/u.test(currency) && amount !== null ? { currency, amount } : null
}

function coverageValue(value: unknown): TurnUsageSummary['estimateCoverage'] | null {
  return value === 'complete' || value === 'partial' || value === 'unavailable'
    ? value
    : null
}

function nullableAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function nullablePositiveAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function pricingModeValue(value: unknown): TurnUsageReferencePriceGroup['pricingMode'] | null {
  return value === 'standard' || value === 'fast' || value === 'long_context' ? value : null
}

function priceItemKindValue(value: unknown): TurnUsageReferencePriceItem['kind'] | null {
  return value === 'uncached_input' || value === 'cache_read' || value === 'cache_write' || value === 'output'
    ? value
    : null
}

function countValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(stringValue).filter(Boolean))]
    : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
