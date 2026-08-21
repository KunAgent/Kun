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
import { MAX_DAILY_USAGE_DAYS } from './usage-service-core.js'
import { hasCacheTelemetry } from './usage-service-aggregation.js'

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export class UsageValidationError extends Error {
  readonly code = 'validation_error'

  constructor(message: string) {
    super(message)
    this.name = 'UsageValidationError'
  }
}

export type DailyUsageQuery = {
  groupBy: 'day'
  from: string
  to: string
  timezone: string
}

export type ModelUsageQuery = {
  groupBy: 'model'
  from: string
  to: string
  timezone: string
}

export type TurnUsageQuery = {
  groupBy: 'turn'
  threadId: string
}

export type ThreadUsageRecord = {
  threadId: string
  turnId?: string
  model?: string
  completedAt: string
  usage: UsageSnapshot
}

export type DailyUsageAccumulator = DailyUsageBucket & {
  threadIds: Set<string>
  hasCacheTelemetry: boolean
}

export type ThreadUsageAccumulator = ThreadUsageBucket & {
  hasCacheTelemetry: boolean
  /** completedAt of the latest record folded in, to pick last_turn_cache_hit_rate. */
  lastCompletedAt: string
}

export type ModelUsageAccumulator = ModelUsageBucket & {
  threadIds: Set<string>
  hasCacheTelemetry: boolean
}

export type UsageCountersTarget = Pick<
  DailyUsageCounters,
  | 'input_tokens'
  | 'output_tokens'
  | 'reasoning_tokens'
  | 'cached_tokens'
  | 'cache_write_tokens'
  | 'cache_miss_tokens'
  | 'total_tokens'
  | 'cost_usd'
  | 'cost_cny'
  | 'value_estimate_usd'
  | 'value_estimate_cny'
  | 'value_estimate_priced_requests'
  | 'value_estimate_unpriced_requests'
  | 'value_estimate_coverage'
  | 'cache_savings_usd'
  | 'cache_savings_cny'
  | 'token_economy_savings_tokens'
  | 'token_economy_savings_usd'
  | 'token_economy_savings_cny'
  | 'turns'
>

export function parseTurnUsageQuery(input: Record<string, unknown>): TurnUsageQuery {
  const groupBy = stringParam(input, 'group_by') ?? 'runtime'
  if (groupBy !== 'turn') {
    throw new UsageValidationError(`unsupported usage grouping: ${groupBy}`)
  }
  const threadId = stringParam(input, 'thread_id')
  if (!threadId) throw new UsageValidationError('turn usage requires thread_id')
  if (threadId.length > 512) throw new UsageValidationError('thread_id is too long')
  return { groupBy: 'turn', threadId }
}

export function defaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
  } catch {
    throw new UsageValidationError(`invalid timezone: ${timezone}`)
  }
}

export function parseDateString(value: string, field: string): Date {
  if (!DATE_RE.test(value)) {
    throw new UsageValidationError(`${field} must use YYYY-MM-DD`)
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new UsageValidationError(`${field} must be a valid calendar date`)
  }
  return date
}

export function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

export function dateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function inclusiveDayCount(from: string, to: string): number {
  const start = parseDateString(from, 'from')
  const end = parseDateString(to, 'to')
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (days <= 0) {
    throw new UsageValidationError('from must be on or before to')
  }
  if (days > MAX_DAILY_USAGE_DAYS) {
    throw new UsageValidationError(`daily usage range must be ${MAX_DAILY_USAGE_DAYS} days or less`)
  }
  return days
}

export function stringParam(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  if (Array.isArray(value)) {
    const first = value[0]
    return typeof first === 'string' && first.trim() ? first.trim() : undefined
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function parseDailyUsageQuery(
  input: Record<string, unknown>,
  runtimeDefaultTimezone = defaultTimezone(),
  now = new Date()
): DailyUsageQuery {
  const groupBy = stringParam(input, 'group_by') ?? 'runtime'
  if (groupBy !== 'day') {
    throw new UsageValidationError(`unsupported usage grouping: ${groupBy}`)
  }
  const timezone = stringParam(input, 'timezone') ?? runtimeDefaultTimezone
  assertValidTimezone(timezone)
  const { from, to } = resolveUsageWindow(input, timezone, now, 'daily usage')
  inclusiveDayCount(from, to)
  return { groupBy: 'day', from, to, timezone }
}

export function parseModelUsageQuery(
  input: Record<string, unknown>,
  runtimeDefaultTimezone = defaultTimezone(),
  now = new Date()
): ModelUsageQuery {
  const groupBy = stringParam(input, 'group_by') ?? 'runtime'
  if (groupBy !== 'model') {
    throw new UsageValidationError(`unsupported usage grouping: ${groupBy}`)
  }
  const timezone = stringParam(input, 'timezone') ?? runtimeDefaultTimezone
  assertValidTimezone(timezone)
  const { from, to } = resolveUsageWindow(input, timezone, now, 'model usage')
  inclusiveDayCount(from, to)
  return { groupBy: 'model', from, to, timezone }
}

export function resolveUsageWindow(
  input: Record<string, unknown>,
  timezone: string,
  now: Date,
  label: string
): { from: string; to: string } {
  const from = stringParam(input, 'from')
  const to = stringParam(input, 'to')
  if (from && to) return { from, to }
  if (from || to) throw new UsageValidationError(`${label} requires both from and to`)
  const window = stringParam(input, 'window')?.toLowerCase().replace(/-/g, '_')
  if (!window) throw new UsageValidationError(`${label} requires from and to`)
  const toDate = formatDateInTimezone(now.toISOString(), timezone)
  if (!toDate) throw new UsageValidationError('invalid usage window date')
  const days = (() => {
    switch (window) {
      case 'today':
        return 1
      case 'week':
        return 7
      case 'month':
        return 30
      case 'all':
      case 'all_time':
      case 'alltime':
        return MAX_DAILY_USAGE_DAYS
      default:
        throw new UsageValidationError(`unsupported usage window: ${window}`)
    }
  })()
  return {
    from: dateString(addUtcDays(parseDateString(toDate, 'to'), -(days - 1))),
    to: toDate
  }
}

export function formatDateInTimezone(isoTimestamp: string, timezone: string): string | null {
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return year && month && day ? `${year}-${month}-${day}` : null
}
