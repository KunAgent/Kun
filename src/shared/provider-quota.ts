export const PROVIDER_QUOTA_STATUSES = [
  'available',
  'unsupported',
  'missing_credentials',
  'error'
] as const

export type ProviderQuotaStatus = (typeof PROVIDER_QUOTA_STATUSES)[number]

export type ProviderQuotaMetric = {
  id: string
  label: string
  unit: string
  used?: number
  limit?: number
  remaining?: number
  usedPercent?: number
  resetsAt?: string
}

export type ProviderLocalCostCoverage = 'complete' | 'partial' | 'unavailable'

export type ProviderLocalCostWindow = {
  requests: number
  totalTokens: number
  amount: number | null
  coverage: ProviderLocalCostCoverage
}

export type ProviderLocalCostSummary = {
  kind: 'reference_api_estimate'
  currency: 'USD'
  today: ProviderLocalCostWindow
  last30Days: ProviderLocalCostWindow
  updatedAt: string
}

export type ProviderQuotaEntry = {
  providerId: string
  providerName: string
  presetId?: string
  status: ProviderQuotaStatus
  source?: string
  dashboardUrl?: string
  summary?: string
  metrics: ProviderQuotaMetric[]
  localCost?: ProviderLocalCostSummary
  updatedAt?: string
  message?: string
}

export type ProviderQuotaListResult = {
  entries: ProviderQuotaEntry[]
  refreshedAt: string
}
