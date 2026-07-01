import type { CacheMissReason } from './cache-diagnostics.js'

/**
 * Trend-based cache-hit-rate regression analysis.
 *
 * {@link diagnoseCacheUsage} explains the per-turn miss reasons, but it does
 * not know whether the *rate itself dropped* relative to how the thread had
 * been performing. This module compares the current cacheable hit rate against
 * a rolling baseline of recent turns, classifies the severity of any drop, and
 * attributes it to the most likely cause so the GUI can say, for example:
 * "Cache hit rate dropped from 92% to 8% (-84pp). Likely cause: the stable
 * system prefix changed."
 */

export type CacheRegressionSeverity = 'none' | 'minor' | 'major' | 'cliff'

export type CacheRegressionReport = {
  severity: CacheRegressionSeverity
  baselineHitRate: number | null
  currentHitRate: number | null
  /** Drop in percentage points (baseline - current) * 100, rounded to 1dp. */
  dropPercentagePoints: number | null
  /** The miss reason most likely responsible for the drop, when known. */
  primaryReason: CacheMissReason | null
  /** Human-readable explanation, only set when severity is not 'none'. */
  explanation: string | null
}

// Absolute drop thresholds in hit-rate fraction (0..1).
const MINOR_DROP = 0.08
const MAJOR_DROP = 0.2
const CLIFF_DROP = 0.4

/**
 * Reasons ordered by how decisively they explain a cache regression. The first
 * present reason wins, so a prefix change (which invalidates the whole cached
 * prefix) is reported ahead of a generic provider miss.
 */
const REASON_PRIORITY: readonly CacheMissReason[] = [
  'stable_prefix_changed',
  'tool_catalog_changed',
  'skills_changed',
  'model_changed',
  'provider_changed',
  'endpoint_changed',
  'provider_cache_miss',
  'cache_ttl_unknown',
  'cold_request',
  'provider_metrics_unavailable'
]

const REASON_TEXT: Record<CacheMissReason, string> = {
  cold_request: 'this was the first request in the thread, so there was no warm cache yet',
  model_changed: 'the model changed, which starts a new provider cache',
  provider_changed: 'the provider changed, which starts a new provider cache',
  endpoint_changed: 'the endpoint format changed, which starts a new provider cache',
  stable_prefix_changed: 'the stable system prefix changed and invalidated the cached prefix',
  tool_catalog_changed: 'the tool catalog changed (MCP/Skill tools), which invalidated the cached prefix',
  skills_changed: 'the active Skill set changed, which invalidated the cached prefix',
  cache_ttl_unknown: 'the provider cache TTL likely expired before this turn',
  provider_cache_miss: 'the provider reported a full cache miss for this turn',
  provider_metrics_unavailable: 'the provider did not report cache metrics, so the cause cannot be confirmed'
}

export function analyzeCacheRegression(input: {
  current: number | null
  baseline: readonly (number | null)[]
  reasons?: readonly CacheMissReason[]
  /** Minimum number of usable baseline samples before reporting a drop. */
  minBaselineSamples?: number
}): CacheRegressionReport {
  const minSamples = Math.max(1, input.minBaselineSamples ?? 1)
  const samples = input.baseline.filter((value): value is number => isRate(value))
  const current = isRate(input.current) ? input.current : null
  // Median is robust to a single cold-start zero or one anomalous spike, so a
  // lone outlier in the window cannot drag the baseline and fake a regression.
  const baseline = samples.length > 0 ? median(samples) : null
  const primaryReason = pickPrimaryReason(input.reasons ?? [])

  if (current === null || baseline === null || samples.length < minSamples) {
    return {
      severity: 'none',
      baselineHitRate: baseline,
      currentHitRate: current,
      dropPercentagePoints: null,
      primaryReason,
      explanation: null
    }
  }

  const drop = baseline - current
  const severity = classifyDrop(drop)
  const dropPercentagePoints = round1(drop * 100)
  if (severity === 'none') {
    return { severity, baselineHitRate: baseline, currentHitRate: current, dropPercentagePoints, primaryReason, explanation: null }
  }
  return {
    severity,
    baselineHitRate: baseline,
    currentHitRate: current,
    dropPercentagePoints,
    primaryReason,
    explanation: explainCacheRegression({ baseline, current, primaryReason })
  }
}

export function explainCacheRegression(input: {
  baseline: number
  current: number
  primaryReason: CacheMissReason | null
}): string {
  const drop = round1((input.baseline - input.current) * 100)
  const head = `Cache hit rate dropped from ${pct(input.baseline)} to ${pct(input.current)} (-${drop}pp).`
  const cause = input.primaryReason ? ` Likely cause: ${REASON_TEXT[input.primaryReason]}.` : ''
  return `${head}${cause}`
}

function classifyDrop(drop: number): CacheRegressionSeverity {
  if (drop >= CLIFF_DROP) return 'cliff'
  if (drop >= MAJOR_DROP) return 'major'
  if (drop >= MINOR_DROP) return 'minor'
  return 'none'
}

function pickPrimaryReason(reasons: readonly CacheMissReason[]): CacheMissReason | null {
  for (const reason of REASON_PRIORITY) {
    if (reasons.includes(reason)) return reason
  }
  return null
}

function isRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

/** Ordinal severity for cooldown comparisons; higher means a worse drop. */
export function cacheRegressionSeverityRank(severity: CacheRegressionSeverity): number {
  return { none: 0, minor: 1, major: 2, cliff: 3 }[severity]
}

/** Median of the sample window — robust to a single cold-start or outlier. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`
}
