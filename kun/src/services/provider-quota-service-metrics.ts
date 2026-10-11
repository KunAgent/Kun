import {
  ProviderQuotaListResponseSchema,
  type ProviderQuotaEntry,
  type ProviderQuotaListResponse,
  type ProviderQuotaMetric
} from '../contracts/provider-quota.js'
import { createProxyFetch } from '../adapters/model/proxy-fetch.js'
import {
  ProviderQuotaMissingCredentialError,
  runSubscriptionQuotaProbe,
  type ProviderQuotaFetch,
  type ProviderQuotaProbeProfile,
  type SubscriptionQuotaProbeKind,
  type SubscriptionQuotaRuntime
} from './provider-subscription-quota.js'
import { type JsonRecord, ProviderQuotaRequestError } from './provider-quota-service-core.js'

export function moneyMetric(
  id: string,
  label: string,
  used: number | undefined,
  limit: number | undefined
): ProviderQuotaMetric {
  const remaining = used === undefined || limit === undefined
    ? undefined
    : Math.max(0, limit - used)
  return {
    id,
    label,
    unit: 'USD',
    ...(used === undefined ? {} : { used }),
    ...(limit === undefined ? {} : { limit }),
    ...(remaining === undefined ? {} : { remaining }),
    ...percentageFields(used, limit)
  }
}

export function parseMiniMaxModelMetrics(item: unknown, index: number): ProviderQuotaMetric[] {
  if (!isRecord(item)) return []
  const model = stringValue(item.model_name) || `Model ${index + 1}`
  const metrics: ProviderQuotaMetric[] = []
  const interval = miniMaxWindowMetric({
    id: `interval-${index}`,
    label: `${model} interval quota`,
    total: item.current_interval_total_count,
    remaining: item.current_interval_usage_count,
    remainingPercent: item.current_interval_remaining_percent,
    status: item.current_interval_status,
    endTime: item.end_time
  })
  if (interval) metrics.push(interval)
  if (isMiniMaxTextModel(model)) {
    const weekly = miniMaxWindowMetric({
      id: `weekly-${index}`,
      label: `${model} weekly quota`,
      total: item.current_weekly_total_count ?? item.weekly_total_count,
      remaining: item.current_weekly_usage_count ?? item.weekly_usage_count,
      remainingPercent: item.current_weekly_remaining_percent ?? item.weekly_remaining_percent,
      status: item.current_weekly_status ?? item.weekly_status,
      endTime: item.weekly_end_time
    })
    if (weekly) metrics.push({ ...weekly, windowSeconds: 7 * 86_400 })
  }
  return metrics
}

export function miniMaxWindowMetric(input: {
  id: string
  label: string
  total: unknown
  remaining: unknown
  remainingPercent: unknown
  status: unknown
  endTime: unknown
}): ProviderQuotaMetric | null {
  let limit = numberValue(input.total)
  let remaining = numberValue(input.remaining)
  const remainingPercent = numberValue(input.remainingPercent)
  if (limit === undefined && remaining === undefined && remainingPercent === undefined) return null
  if (
    numberValue(input.status) === 3 &&
    (limit ?? 0) === 0 &&
    (remaining ?? 0) === 0 &&
    (remainingPercent ?? 0) >= 100
  ) return null
  if (remainingPercent !== undefined && limit === 0 && remaining === 0) {
    limit = undefined
    remaining = undefined
  }
  const used = limit === undefined || remaining === undefined
    ? undefined
    : Math.max(0, limit - remaining)
  const resetsAt = epochToIso(input.endTime)
  return {
    id: input.id,
    label: input.label,
    unit: 'requests',
    ...(used === undefined ? {} : { used }),
    ...(limit === undefined ? {} : { limit }),
    ...(remaining === undefined ? {} : { remaining }),
    ...(remainingPercent === undefined
      ? percentageFields(used, limit)
      : { usedPercent: clampPercentage(100 - remainingPercent) }),
    ...(resetsAt ? { resetsAt } : {})
  }
}

export function isMiniMaxTextModel(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return normalized === 'general' ||
    normalized.includes('minimax-m') ||
    normalized.startsWith('m2.')
}

export function percentageFields(
  used: number | undefined,
  limit: number | undefined
): { usedPercent?: number } {
  if (used === undefined || limit === undefined || limit <= 0) return {}
  return { usedPercent: clampPercentage((used / limit) * 100) }
}

export function pushRemainingMetric(
  metrics: ProviderQuotaMetric[],
  id: string,
  label: string,
  unit: string,
  rawRemaining: unknown
): void {
  const remaining = numberValue(rawRemaining)
  if (remaining !== undefined) metrics.push({ id, label, unit, remaining })
}

export function kimiUsageMetric(
  id: string,
  label: string,
  value: unknown
): ProviderQuotaMetric | null {
  const detail = optionalRecord(value)
  if (!detail) return null
  const limit = numberValue(detail.limit)
  const remaining = numberValue(detail.remaining)
  const explicitUsed = numberValue(detail.used)
  const used = explicitUsed ?? (
    limit === undefined || remaining === undefined
      ? undefined
      : Math.max(0, limit - remaining)
  )
  if (limit === undefined && remaining === undefined && used === undefined) return null
  const resetsAt = isoDateValue(
    detail.resetTime ??
    detail.resetAt ??
    detail.reset_time ??
    detail.reset_at
  )
  return {
    id,
    label,
    unit: 'requests',
    ...(used === undefined ? {} : { used }),
    ...(limit === undefined ? {} : { limit }),
    ...(remaining === undefined ? {} : { remaining }),
    ...percentageFields(used, limit),
    ...(resetsAt ? { resetsAt } : {})
  }
}

export function quotaWindowLabel(number: unknown, unit: unknown): string {
  const numeric = numberValue(number)
  const numericUnit = numberValue(unit)
  const textUnit = stringValue(unit) || (
    numericUnit === 1 ? 'day'
      : numericUnit === 3 ? 'hour'
        : numericUnit === 5 ? 'minute'
          : numericUnit === 6 ? 'week'
            : ''
  )
  return numeric === undefined || !textUnit ? '' : `${numeric}-${textUnit.toLowerCase()}`
}

export function epochToIso(value: unknown): string | undefined {
  const numeric = numberValue(value)
  if (numeric === undefined || numeric <= 0) return undefined
  const date = new Date(numeric < 100_000_000_000 ? numeric * 1_000 : numeric)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function isoDateValue(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function exactHostname(baseUrl: string | undefined): string {
  try {
    return baseUrl ? new URL(baseUrl).hostname.toLowerCase() : ''
  } catch {
    return ''
  }
}

export function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 512) : ''
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function optionalRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined
}

export function requireRecord(value: unknown, message: string): JsonRecord {
  if (!isRecord(value)) throw new Error(message)
  return value
}

export function clampPercentage(value: number): number {
  return Math.min(100, Math.max(0, value))
}

export function quotaErrorMessage(error: unknown): string {
  if (error instanceof ProviderQuotaRequestError) return error.message
  if (error instanceof Error && error.message) return error.message.slice(0, 4_096)
  return 'The provider quota request failed.'
}
