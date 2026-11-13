import type { DailyUsageCounters } from '../../../kun/src/contracts/usage.js'

/** Synthetic ledger counters shared by the mobile projection and dispatch boundary tests. */
export const usageCounters: DailyUsageCounters = {
  input_tokens: 10000, output_tokens: 2000, reasoning_tokens: 100, cached_tokens: 9000, cache_write_tokens: 500,
  cache_miss_tokens: 1000, total_tokens: 12000, cost_usd: .03, cost_cny: 0, value_estimate_usd: .25,
  value_estimate_cny: 0, value_estimate_coverage: 'partial', value_estimate_priced_requests: 4,
  value_estimate_unpriced_requests: 1, cache_savings_usd: 0, cache_savings_cny: 0,
  token_economy_savings_tokens: 200, token_economy_savings_usd: 0, token_economy_savings_cny: 0,
  turns: 5, thread_count: 3, cache_hit_rate: .9
}
export function usageResponse(path: string) {
  const url = new URL(path, 'http://fixture.invalid'), from = url.searchParams.get('from'), to = url.searchParams.get('to')
  const group_by = url.searchParams.get('group_by'), timezone = url.searchParams.get('timezone')
  const common = { group_by, from, to, timezone, totals: { ...usageCounters, days: 7, active_days: 1 } }
  const days = [{ ...usageCounters, date: to }]
  return group_by === 'day' ? { ...common, buckets: days }
    : { ...common, scope: url.searchParams.get('scope'), buckets: [{ ...usageCounters, model: 'fixture-model' }], days }
}
