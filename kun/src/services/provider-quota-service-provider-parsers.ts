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
import { clampPercentage, epochToIso, isRecord, kimiUsageMetric, moneyMetric, numberValue, optionalRecord, parseMiniMaxModelMetrics, percentageFields, pushRemainingMetric, quotaWindowLabel, requireRecord, stringValue } from './provider-quota-service-metrics.js'

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
  if (!metrics.length) throw new Error('DeepSeek did not return a numeric account balance.')
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
  const metrics = [moneyMetric('credits', 'Credits', totalUsage, totalCredits)]
  const keyData = optionalRecord(optionalRecord(keyPayload)?.data)
  const keyLimit = numberValue(keyData?.limit)
  const keyUsage = numberValue(keyData?.usage)
  if (keyLimit !== undefined || keyUsage !== undefined) {
    metrics.push(moneyMetric('key-budget', 'API key budget', keyUsage, keyLimit))
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
  if (!metrics.length) throw new Error('Moonshot did not return a numeric account balance.')
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
    const inferredUsed = limit === undefined || remaining === undefined ? undefined : limit - remaining
    const rawUsed = explicitUsed === undefined
      ? inferredUsed
      : inferredUsed === undefined
        ? explicitUsed
        : Math.max(explicitUsed, inferredUsed)
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
  if (!metrics.length) throw new Error('Z.ai did not return a recognized quota limit.')
  const summary = stringValue(data.planName) ||
    stringValue(data.plan) ||
    stringValue(data.plan_type) ||
    stringValue(data.packageName) ||
    stringValue(data.level)
  return { metrics, ...(summary ? { summary } : {}) }
}

function zaiPercentageMetric(
  item: Record<string, unknown>,
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
  const data = optionalRecord(root.data) ?? root
  const baseResponse = optionalRecord(root.base_resp) ?? optionalRecord(data.base_resp)
  const statusCode = numberValue(baseResponse?.status_code)
  if (statusCode !== undefined && statusCode !== 0) {
    throw new Error('MiniMax rejected the quota request.')
  }
  const remains = Array.isArray(data.model_remains) ? data.model_remains : []
  const metrics = remains.flatMap((item, index) => parseMiniMaxModelMetrics(item, index))
  if (!metrics.length) throw new Error('MiniMax did not return a recognized coding-plan quota.')
  const card = optionalRecord(data.current_combo_card)
  const summary = stringValue(data.current_subscribe_title) ||
    stringValue(data.plan_name) ||
    stringValue(data.combo_title) ||
    stringValue(data.current_plan_title) ||
    stringValue(card?.title)
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
  const grantItems = Array.isArray(optionalRecord(root.grants)?.data)
    ? optionalRecord(root.grants)!.data as unknown[]
    : []
  const expiries = grantItems.flatMap((item) => {
    if (!isRecord(item)) return []
    const seconds = numberValue(item.expires_at)
    return seconds !== undefined && seconds * 1_000 > Date.now() ? [seconds * 1_000] : []
  }).sort((a, b) => a - b)
  return [{
    id: 'credits',
    label: 'Credits',
    unit: 'USD',
    ...(used === undefined ? {} : { used }),
    ...(limit === undefined ? {} : { limit }),
    ...(remaining === undefined ? {} : { remaining }),
    ...percentageFields(used, limit),
    ...(expiries[0] === undefined ? {} : { resetsAt: new Date(expiries[0]).toISOString() })
  }]
}

export function parseKimiCodeQuota(payload: unknown): ProviderQuotaMetric[] {
  const root = requireRecord(payload, 'Kimi Code returned an invalid usage response.')
  const metrics: ProviderQuotaMetric[] = []
  const weekly = kimiUsageMetric('weekly', 'Weekly request quota', root.usage)
  if (weekly) metrics.push(weekly)

  const limits = Array.isArray(root.limits) ? root.limits : []
  limits.forEach((value, index) => {
    const limit = optionalRecord(value)
    const window = optionalRecord(limit?.window)
    const duration = numberValue(window?.duration)
    const unit = stringValue(window?.timeUnit).toLowerCase()
    const label = duration === 300 && unit.includes('minute')
      ? '5-hour rate limit'
      : `Rate limit ${index + 1}`
    const metric = kimiUsageMetric(`rate-limit-${index}`, label, limit?.detail)
    const scale = unit.includes('minute') ? 60 : unit.includes('hour') ? 3_600 : unit.includes('day') ? 86_400 : undefined
    if (metric && scale && duration && Number.isInteger(duration) && duration > 0) metric.windowSeconds = duration * scale
    if (metric) metrics.push(metric)
  })

  if (!metrics.length) throw new Error('Kimi Code did not return a recognized usage limit.')
  return metrics
}
