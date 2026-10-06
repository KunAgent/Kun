import type { ProviderQuotaMetric } from '../contracts/provider-quota.js'
import { numberValue } from './provider-quota-service-metrics.js'

/**
 * Balance readers for relays and vendors that report a remaining amount to
 * the API key itself. Amounts are shown as the vendor reports them; they are
 * not reconciled bills.
 */
function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function remaining(id: string, label: string, unit: string, raw: unknown): ProviderQuotaMetric | null {
  const value = numberValue(raw)
  return value === undefined ? null : { id, label, unit, remaining: value }
}

/** SiliconFlow `/v1/user/info`: data.totalBalance (with chargeBalance and balance beside it). */
export function parseSiliconFlowBalance(payload: unknown, unit: 'CNY' | 'USD'): ProviderQuotaMetric[] {
  const root = record(payload, 'SiliconFlow returned an invalid account response.')
  if (root.status === false) throw new Error(typeof root.message === 'string' ? root.message : 'SiliconFlow rejected the balance request.')
  const data = record(root.data, 'SiliconFlow did not return account information.')
  const metrics = [remaining('total-balance', 'Total balance', unit, data.totalBalance),
    remaining('charge-balance', 'Paid balance', unit, data.chargeBalance),
    remaining('gift-balance', 'Gift balance', unit, data.balance)].filter((metric): metric is ProviderQuotaMetric => Boolean(metric))
  if (!metrics.length) throw new Error('SiliconFlow did not return a numeric balance.')
  return metrics
}

/** StepFun `/v1/accounts`: balance is what is left to spend, vouchers included. */
export function parseStepFunBalance(payload: unknown, unit: 'CNY' | 'USD'): ProviderQuotaMetric[] {
  const root = record(payload, 'StepFun returned an invalid account response.')
  const metrics = [remaining('balance', 'Balance', unit, root.balance),
    remaining('cash-balance', 'Cash paid in', unit, root.total_cash_balance),
    remaining('voucher-balance', 'Vouchers', unit, root.total_voucher_balance)].filter((metric): metric is ProviderQuotaMetric => Boolean(metric))
  if (!metrics.length) throw new Error('StepFun did not return a numeric balance.')
  return metrics
}

/** AiHubMix `/dashboard/billing/remain`: total_usage is what is left on the key, in USD; -1 is a key without a limit. */
export function parseAiHubMixBalance(payload: unknown): ProviderQuotaMetric[] {
  const root = record(payload, 'AiHubMix returned an invalid balance response.')
  const value = numberValue(root.total_usage)
  if (value === undefined) throw new Error('AiHubMix did not return a numeric balance.')
  if (value < 0) throw new Error('This AiHubMix key has no spending limit, so it reports no balance of its own. Give the key a limit in the AiHubMix console to see what is left.')
  return [{ id: 'key-balance', label: 'Key balance', unit: 'USD', remaining: value }]
}

/** new-api / one-api `/api/usage/token`: data.total_available, 500000 units to the dollar. */
export function parseNewApiKeyBalance(payload: unknown): ProviderQuotaMetric[] {
  const root = record(payload, 'The relay returned an invalid key usage response.')
  if (root.code === false || root.success === false) throw new Error(typeof root.message === 'string' ? root.message : 'The relay rejected the key usage request.')
  const data = record(root.data, 'The relay did not return key usage.')
  if (data.unlimited_quota === true) return [{ id: 'key-balance', label: 'Key balance', unit: 'USD' }]
  const available = numberValue(data.total_available)
  const used = numberValue(data.total_used)
  if (available === undefined) throw new Error('The relay did not return a numeric key balance.')
  return [{ id: 'key-balance', label: 'Key balance', unit: 'USD', remaining: available / 500_000,
    ...(used !== undefined ? { used: used / 500_000, limit: (used + available) / 500_000,
      usedPercent: used + available > 0 ? Math.min(100, Math.max(0, used / (used + available) * 100)) : 0 } : {}) }]
}
