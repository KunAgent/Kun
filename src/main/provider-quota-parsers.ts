import {
  getModelProviderSettings,
  type AppSettingsV1,
  type ModelProviderProfileV1
} from '../shared/app-settings'
import type {
  ProviderQuotaEntry,
  ProviderQuotaListResult,
  ProviderQuotaMetric
} from '../shared/provider-quota'
import { fetchWithOptionalProxy } from './proxy-fetch'
import {
  ProviderQuotaMissingCredentialError,
  runSubscriptionQuotaProbe,
  type SubscriptionQuotaProbeKind,
  type SubscriptionQuotaRuntime
} from './provider-subscription-quota'

import {
  JsonRecord,
  ProviderQuotaRequestError
} from './provider-quota-service'

export function parseDeepSeekQuota(payload: unknown): ProviderQuotaMetric[] {
  const root = requireRecord(payload, 'DeepSeek returned an invalid quota response.')
  const balances = Array.isArray(root.balance_infos) ? root.balance_infos : []
  const balance = balances.find(isRecord)
  if (!balance) throw new Error('DeepSeek did not return account balance information.')
  const currency = stringValue(balance.currency) || 'CNY'
  const metrics: ProviderQuotaMetric[] = []
  pushRemainingMetric(metrics, 'balance', 'Account balance', currency, balance.total_balance)
  pushRemainingMetric(metrics, 'paid-balance', 'Paid balance', currency, balance.topped_up_balance)
  pushRemainingMetric(metrics, 'granted-balance', 'Granted balance', currency, balance.granted_balance)
  if (metrics.length === 0) throw new Error('DeepSeek did not return a numeric account balance.')
  return metrics
}

export function parseOpenRouterQuota(
  creditsPayload: unknown,
  keyPayload?: unknown
): ProviderQuotaMetric[] {
  const creditsRoot = requireRecord(creditsPayload, 'OpenRouter returned an invalid credits response.')
  const creditsData = requireRecord(creditsRoot.data, 'OpenRouter did not return credit information.')
  const totalCredits = numberValue(creditsData.total_credits)
  const totalUsage = numberValue(creditsData.total_usage)
  if (totalCredits === undefined && totalUsage === undefined) {
    throw new Error('OpenRouter did not return numeric credit information.')
  }
  const remaining = totalCredits === undefined || totalUsage === undefined
    ? undefined
    : Math.max(0, totalCredits - totalUsage)
  const metrics: ProviderQuotaMetric[] = [{
    id: 'credits',
    label: 'Credits',
    unit: 'USD',
    ...(totalUsage === undefined ? {} : { used: totalUsage }),
    ...(totalCredits === undefined ? {} : { limit: totalCredits }),
    ...(remaining === undefined ? {} : { remaining }),
    ...percentageFields(totalUsage, totalCredits)
  }]

  const keyRoot = optionalRecord(keyPayload)
  const keyData = optionalRecord(keyRoot?.data)
  const keyLimit = numberValue(keyData?.limit)
  const keyUsage = numberValue(keyData?.usage)
  if (keyLimit !== undefined || keyUsage !== undefined) {
    const keyRemaining = keyLimit === undefined || keyUsage === undefined
      ? undefined
      : Math.max(0, keyLimit - keyUsage)
    metrics.push({
      id: 'key-budget',
      label: 'API key budget',
      unit: 'USD',
      ...(keyUsage === undefined ? {} : { used: keyUsage }),
      ...(keyLimit === undefined ? {} : { limit: keyLimit }),
      ...(keyRemaining === undefined ? {} : { remaining: keyRemaining }),
      ...percentageFields(keyUsage, keyLimit)
    })
  }
  return metrics
}

export function parseMoonshotQuota(payload: unknown): ProviderQuotaMetric[] {
  const root = requireRecord(payload, 'Moonshot returned an invalid balance response.')
  if (numberValue(root.code) !== 0 || root.status !== true) {
    throw new Error('Moonshot rejected the balance request.')
  }
  const data = requireRecord(root.data, 'Moonshot did not return balance information.')
  const metrics: ProviderQuotaMetric[] = []
  pushRemainingMetric(metrics, 'available-balance', 'Available balance', 'USD', data.available_balance)
  pushRemainingMetric(metrics, 'cash-balance', 'Cash balance', 'USD', data.cash_balance)
  pushRemainingMetric(metrics, 'voucher-balance', 'Voucher balance', 'USD', data.voucher_balance)
  if (metrics.length === 0) throw new Error('Moonshot did not return a numeric account balance.')
  return metrics
}

export function parseZaiQuota(payload: unknown): {
  metrics: ProviderQuotaMetric[]
  summary?: string
} {
  const root = requireRecord(payload, 'Z.ai returned an invalid quota response.')
  if (numberValue(root.code) !== 200 || root.success !== true) {
    throw new Error('Z.ai rejected the quota request.')
  }
  const data = requireRecord(root.data, 'Z.ai did not return quota information.')
  const limits = Array.isArray(data.limits) ? data.limits : []
  const metrics = limits.flatMap((item, index) => {
    if (!isRecord(item)) return []
    const type = stringValue(item.type)
    const isTokenLimit = type === 'TOKENS_LIMIT'
    const isCreditLimit = type === 'CREDIT_LIMIT'
    if (!isTokenLimit && !isCreditLimit && type !== 'TIME_LIMIT') {
      const fallback = zaiPercentageMetric(item, index, type)
      return fallback ? [fallback] : []
    }
    const limit = numberValue(item.usage)
    const explicitUsed = numberValue(item.currentValue)
    const remaining = numberValue(item.remaining)
    const usedFromRemaining = limit === undefined || remaining === undefined
      ? undefined
      : limit - remaining
    const rawUsed = explicitUsed === undefined
      ? usedFromRemaining
      : usedFromRemaining === undefined
        ? explicitUsed
        : Math.max(explicitUsed, usedFromRemaining)
    const used = rawUsed === undefined
      ? undefined
      : limit === undefined
        ? Math.max(0, rawUsed)
        : Math.max(0, Math.min(limit, rawUsed))
    const percentage = numberValue(item.percentage)
    const derivedPercentage = percentageFields(used, limit)
    const resetsAt = epochToIso(item.nextResetTime)
    const windowLabel = quotaWindowLabel(item.number, item.unit)
    return [{
      id: `${type.toLowerCase()}-${index}`,
      label: isTokenLimit
        ? `${windowLabel ? `${windowLabel} ` : ''}token quota`
        : isCreditLimit
          ? `${windowLabel ? `${windowLabel} ` : ''}credit quota`
          : `${windowLabel ? `${windowLabel} ` : ''}request quota`,
      unit: isTokenLimit ? 'tokens' : isCreditLimit ? 'credits' : 'requests',
      ...(used === undefined ? {} : { used }),
      ...(limit === undefined ? {} : { limit }),
      ...(remaining === undefined ? {} : { remaining }),
      ...(derivedPercentage.usedPercent === undefined
        ? percentage === undefined ? {} : { usedPercent: clampPercentage(percentage) }
        : derivedPercentage),
      ...(resetsAt ? { resetsAt } : {})
    }]
  })
  if (metrics.length === 0) throw new Error('Z.ai did not return a recognized quota limit.')
  const summary = stringValue(data.planName) ||
    stringValue(data.plan) ||
    stringValue(data.plan_type) ||
    stringValue(data.packageName) ||
    stringValue(data.level)
  return { metrics, ...(summary ? { summary } : {}) }
}

function zaiPercentageMetric(
  item: JsonRecord,
  index: number,
  type: string
): ProviderQuotaMetric | null {
  const percentage = numberValue(item.percentage)
  if (percentage === undefined) return null
  const idType = type
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 220) || 'quota'
  const words = type.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const typeLabel = words ? `${words[0].toUpperCase()}${words.slice(1)}` : ''
  const labelSuffix = /\bquota\b/i.test(typeLabel) ? '' : ' quota'
  const label = typeLabel
    ? `${typeLabel.slice(0, 512 - labelSuffix.length)}${labelSuffix}`
    : `Quota ${index + 1}`
  return {
    id: `${idType}-${index}`,
    label,
    unit: 'percent',
    usedPercent: clampPercentage(percentage)
  }
}

export function parseMiniMaxQuota(payload: unknown): {
  metrics: ProviderQuotaMetric[]
  summary?: string
} {
  const root = requireRecord(payload, 'MiniMax returned an invalid quota response.')
  const baseResponse = optionalRecord(root.base_resp) ?? optionalRecord(optionalRecord(root.data)?.base_resp)
  const statusCode = numberValue(baseResponse?.status_code)
  if (statusCode !== undefined && statusCode !== 0) {
    throw new Error('MiniMax rejected the quota request.')
  }
  const data = optionalRecord(root.data) ?? root
  const remains = Array.isArray(data.model_remains) ? data.model_remains : []
  const metrics = remains.flatMap((item, index) => parseMiniMaxModelMetrics(item, index))
  if (metrics.length === 0) throw new Error('MiniMax did not return a recognized coding-plan quota.')
  const comboCard = optionalRecord(data.current_combo_card)
  const summary = stringValue(data.current_subscribe_title) ||
    stringValue(data.plan_name) ||
    stringValue(data.combo_title) ||
    stringValue(data.current_plan_title) ||
    stringValue(comboCard?.title) ||
    stringValue(root.current_subscribe_title)
  return { metrics, ...(summary ? { summary } : {}) }
}

export function parseOpenAiQuota(payload: unknown): ProviderQuotaMetric[] {
  const root = requireRecord(payload, 'OpenAI returned an invalid credit response.')
  const limit = numberValue(root.total_granted)
  const used = numberValue(root.total_used)
  const remaining = numberValue(root.total_available)
  if (limit === undefined && used === undefined && remaining === undefined) {
    throw new Error('OpenAI did not return credit grant information.')
  }
  const grants = optionalRecord(root.grants)
  const grantItems = Array.isArray(grants?.data) ? grants.data : []
  const futureExpiries = grantItems
    .flatMap((item) => {
      if (!isRecord(item)) return []
      const seconds = numberValue(item.expires_at)
      return seconds !== undefined && seconds * 1000 > Date.now() ? [seconds * 1000] : []
    })
    .sort((a, b) => a - b)
  return [{
    id: 'credits',
    label: 'Credits',
    unit: 'USD',
    ...(used === undefined ? {} : { used }),
    ...(limit === undefined ? {} : { limit }),
    ...(remaining === undefined ? {} : { remaining }),
    ...percentageFields(used, limit),
    ...(futureExpiries[0] === undefined ? {} : { resetsAt: new Date(futureExpiries[0]).toISOString() })
  }]
}

export function parseKimiCodeQuota(payload: unknown): ProviderQuotaMetric[] {
  const root = requireRecord(payload, 'Kimi Code returned an invalid usage response.')
  const metrics: ProviderQuotaMetric[] = []
  const weekly = kimiUsageMetric('weekly', 'Weekly request quota', root.usage)
  if (weekly) metrics.push(weekly)

  const limits = Array.isArray(root.limits) ? root.limits : []
  for (const [index, value] of limits.entries()) {
    const limit = optionalRecord(value)
    const window = optionalRecord(limit?.window)
    const duration = numberValue(window?.duration)
    const unit = stringValue(window?.timeUnit).toLowerCase()
    const label = duration === 300 && unit.includes('minute')
      ? '5-hour rate limit'
      : `Rate limit ${index + 1}`
    const metric = kimiUsageMetric(`rate-limit-${index}`, label, limit?.detail)
    if (metric) metrics.push(metric)
  }

  if (metrics.length === 0) {
    throw new Error('Kimi Code did not return a recognized usage limit.')
  }
  return metrics
}

export function parseMiniMaxModelMetrics(item: unknown, index: number): ProviderQuotaMetric[] {
  if (!isRecord(item)) return []
  const model = stringValue(item.model_name) || `Model ${index + 1}`
  const metrics: ProviderQuotaMetric[] = []
  const intervalMetric = miniMaxWindowMetric({
    id: `interval-${index}`,
    label: `${model} interval quota`,
    total: item.current_interval_total_count,
    remaining: item.current_interval_usage_count,
    remainingPercent: item.current_interval_remaining_percent,
    status: item.current_interval_status,
    endTime: item.end_time
  })
  if (intervalMetric) metrics.push(intervalMetric)
  if (isMiniMaxTextModel(model)) {
    const weeklyMetric = miniMaxWindowMetric({
      id: `weekly-${index}`,
      label: `${model} weekly quota`,
      total: item.current_weekly_total_count ?? item.weekly_total_count,
      remaining: item.current_weekly_usage_count ?? item.weekly_usage_count,
      remainingPercent: item.current_weekly_remaining_percent ?? item.weekly_remaining_percent,
      status: item.current_weekly_status ?? item.weekly_status,
      endTime: item.weekly_end_time
    })
    if (weeklyMetric) metrics.push(weeklyMetric)
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
  ) {
    return null
  }
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
  if (remaining === undefined) return
  metrics.push({ id, label, unit, remaining })
}

export function isHttpQuotaPresetKind(
  kind: ModelProviderProfileV1['kind']
): boolean {
  return kind === undefined || kind === 'http'
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
    numericUnit === 1
      ? 'day'
      : numericUnit === 3
        ? 'hour'
        : numericUnit === 5
          ? 'minute'
          : numericUnit === 6
            ? 'week'
            : ''
  )
  if (numeric === undefined || !textUnit) return ''
  return `${numeric}-${textUnit.toLowerCase()}`
}

export function epochToIso(value: unknown): string | undefined {
  const numeric = numberValue(value)
  if (numeric === undefined || numeric <= 0) return undefined
  const milliseconds = numeric < 100_000_000_000 ? numeric * 1000 : numeric
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function isoDateValue(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const normalized = value.trim().replace(
    /(\.\d{3})\d+(Z|[+-]\d{2}:\d{2})$/,
    '$1$2'
  )
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function exactHostname(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase()
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
  return typeof value === 'string' ? value.trim() : ''
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
  if (error instanceof Error && error.message) return error.message
  return 'The provider quota request failed.'
}
