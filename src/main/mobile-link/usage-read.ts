import {
  validateProviderQuotas, validateUsageSummary, validateUsageSummaryParams,
  type CapabilityDescriptor, type ProviderQuotas, type UsageCounters, type UsageSummary, type UsageSummaryParams
} from '@kun/remote-protocol'
import { DailyUsageResponseSchema, ModelUsageResponseSchema, type DailyUsageCounters } from '../../../kun/src/contracts/usage.js'
import { ProviderQuotaListResponseSchema } from '../../../kun/src/contracts/provider-quota.js'
import type { ProtectedRuntimeRequestLease } from '../ipc/app-ipc-handler-options'
import type { MobileLinkScope } from '../../shared/mobile-link-scopes'

export function usageDescriptors(scopes: MobileLinkScope[]): CapabilityDescriptor[] {
  return scopes.includes('personal') ? ['usage.summary.get', 'usage.quotas.list'].map(operation => ({
    operation, schemaVersion: 1, resourceKind: 'catalog', allowedActions: ['read'],
    supported: true, enabled: true, authorized: true, online: true, limits: { days: 90, models: 100, providers: 50 }
  })) : []
}

/** Match the desktop's local-calendar queries, including a phone in a different timezone. */
export function usageRange(days: number, now = new Date(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: string) => parts.find(value => value.type === type)!.value
  const to = `${part('year')}-${part('month')}-${part('day')}`
  const start = new Date(`${to}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - days + 1)
  return { from: start.toISOString().slice(0, 10), to, timezone }
}

function counters(value: DailyUsageCounters): UsageCounters {
  return {
    inputTokens: value.input_tokens, outputTokens: value.output_tokens, reasoningTokens: value.reasoning_tokens,
    cachedTokens: value.cached_tokens, cacheMissTokens: value.cache_miss_tokens, cacheWriteTokens: value.cache_write_tokens,
    totalTokens: value.total_tokens, costUsd: value.cost_usd, costCny: value.cost_cny,
    referenceUsd: value.value_estimate_usd, referenceCny: value.value_estimate_cny,
    referenceCoverage: value.value_estimate_coverage, unpricedRequests: value.value_estimate_unpriced_requests,
    savedTokens: value.token_economy_savings_tokens, turns: value.turns, threadCount: value.thread_count,
    cacheHitRate: value.cache_hit_rate
  }
}

async function read(lease: ProtectedRuntimeRequestLease, path: string) {
  const response = await lease.request(path, 'GET')
  if (!response.ok) throw Error(response.status === 404 ? 'UNSUPPORTED_OPERATION' : 'USAGE_UNAVAILABLE')
  try { return JSON.parse(response.body) as unknown } catch { throw Error('INVALID_USAGE_RESPONSE') }
}

/** Reuse the same runtime endpoints as the desktop panels; never read settings, secrets or session files here. */
export async function readMobileUsage(lease: ProtectedRuntimeRequestLease, raw: unknown, now = new Date()): Promise<UsageSummary> {
  const params: UsageSummaryParams['usage.summary.get'] = validateUsageSummaryParams('usage.summary.get', raw)
  const range = usageRange(params.days, now), query = new URLSearchParams(range)
  const responses = await Promise.all([
    read(lease, '/v1/usage?' + query + '&group_by=day'),
    read(lease, '/v1/usage?' + query + '&group_by=model&scope=' + params.modelScope)
  ])
  const daily = DailyUsageResponseSchema.safeParse(responses[0]), models = ModelUsageResponseSchema.safeParse(responses[1])
  if (!daily.success || !models.success) throw Error('INVALID_USAGE_RESPONSE')
  if (daily.data.from !== range.from || daily.data.to !== range.to || daily.data.timezone !== range.timezone ||
    models.data.from !== range.from || models.data.to !== range.to || models.data.timezone !== range.timezone || models.data.scope !== params.modelScope)
    throw Error('INVALID_USAGE_RESPONSE')
  const sorted = [...models.data.buckets].sort((a, b) => b.total_tokens - a.total_tokens)
  return validateUsageSummary({ ...range, ...params, totals: counters(daily.data.totals),
    daily: daily.data.buckets.map(bucket => ({ date: bucket.date, ...counters(bucket) })),
    models: sorted.slice(0, 100).map(bucket => ({ model: bucket.model.slice(0, 256), ...counters(bucket) })),
    modelsTruncated: sorted.length > 100, degraded: Boolean(daily.data.degraded || models.data.degraded), syncedAt: Date.now() })
}

export async function readMobileQuotas(lease: ProtectedRuntimeRequestLease): Promise<ProviderQuotas> {
  // Reuse the runtime's shared quota TTL and single-flight cache, including provider backoff.
  const parsed = ProviderQuotaListResponseSchema.safeParse(await read(lease, '/v1/provider-quotas'))
  if (!parsed.success) throw Error('INVALID_USAGE_RESPONSE')
  return validateProviderQuotas({ refreshedAt: parsed.data.refreshedAt, truncated: parsed.data.entries.length > 50,
    entries: parsed.data.entries.slice(0, 50).map(entry => ({
      providerId: entry.providerId, providerName: entry.providerName, status: entry.status,
      metrics: entry.metrics.slice(0, 16).map(metric => ({ ...metric })), metricsTruncated: entry.metrics.length > 16,
      ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}), ...(entry.localCost ? { localCost: entry.localCost } : {})
    })) })
}
