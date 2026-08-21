import {
  aggregateCodexReferenceValue,
  type CodexSubscriptionValueInput
} from '../adapters/model/codex-subscription-pricing.js'
import type {
  ProviderLocalCostSummary,
  ProviderLocalCostWindow
} from '../contracts/provider-quota.js'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000

export type ProviderLocalCostProfile = {
  id: string
  presetId?: string
}

export type ProviderLocalCostUsageRecord = {
  completedAt: string
  model?: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cacheHitTokens?: number
    cacheWriteTokens?: number
    actualProviderId?: string
    actualModelId?: string
    requestedModelId?: string
    billingKind?: 'api' | 'subscription'
    serviceTier?: 'priority'
    turns?: number
  }
}

type CostWindowAccumulator = {
  requests: number
  totalTokens: number
  estimates: CodexSubscriptionValueInput[]
}

type ProviderAccumulator = {
  today: CostWindowAccumulator
  last30Days: CostWindowAccumulator
}

/**
 * Attribute durable Kun usage to configured Codex accounts and calculate the
 * two local reference-value windows used by every provider quota client.
 */
export function aggregateCodexProviderLocalCosts(input: {
  profiles: readonly ProviderLocalCostProfile[]
  records: readonly ProviderLocalCostUsageRecord[]
  now?: Date
}): Readonly<Record<string, ProviderLocalCostSummary | undefined>> {
  const codexProfiles = input.profiles.filter(isCodexProfile)
  if (codexProfiles.length === 0) return {}

  const now = validDate(input.now) ?? new Date()
  const nowMs = now.getTime()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayStartMs = todayStart.getTime()
  const rollingStartMs = nowMs - THIRTY_DAYS_MS
  const codexIds = new Set(codexProfiles.map((profile) => profile.id))
  const accumulators = new Map(
    codexProfiles.map((profile) => [profile.id, emptyProviderAccumulator()])
  )

  for (const record of input.records) {
    if (!isModelUsageRecord(record)) continue
    const completedAtMs = Date.parse(record.completedAt)
    if (!Number.isFinite(completedAtMs) || completedAtMs > nowMs || completedAtMs < rollingStartMs) {
      continue
    }
    const model = usageModel(record)
    const actualProviderId = record.usage.actualProviderId?.trim()
    let providerId: string | undefined
    if (actualProviderId) {
      if (!codexIds.has(actualProviderId)) continue
      providerId = actualProviderId
    } else if (isPotentialLegacyCodexUsage(record, model)) {
      if (codexProfiles.length === 1) {
        providerId = codexProfiles[0]?.id
      } else {
        continue
      }
    } else {
      continue
    }

    if (!providerId) continue
    const accumulator = accumulators.get(providerId)
    if (!accumulator) continue
    const estimateInput: CodexSubscriptionValueInput = {
      model,
      promptTokens: nonNegativeInteger(record.usage.promptTokens),
      completionTokens: nonNegativeInteger(record.usage.completionTokens),
      ...(record.usage.cacheHitTokens !== undefined
        ? { cacheHitTokens: nonNegativeInteger(record.usage.cacheHitTokens) }
        : {}),
      ...(record.usage.cacheWriteTokens !== undefined
        ? { cacheWriteTokens: nonNegativeInteger(record.usage.cacheWriteTokens) }
        : {}),
      completedAt: record.completedAt,
      ...(record.usage.serviceTier ? { serviceTier: record.usage.serviceTier } : {}),
      requestCount: requestCount(record)
    }
    addRecord(accumulator.last30Days, record, estimateInput)
    if (completedAtMs >= todayStartMs) addRecord(accumulator.today, record, estimateInput)
  }

  const updatedAt = now.toISOString()
  return Object.fromEntries(codexProfiles.map((profile) => {
    const accumulator = accumulators.get(profile.id) ?? emptyProviderAccumulator()
    return [profile.id, {
      kind: 'reference_api_estimate' as const,
      currency: 'USD' as const,
      today: finishWindow(accumulator.today),
      last30Days: finishWindow(accumulator.last30Days),
      updatedAt
    }]
  }))
}

function isCodexProfile(profile: ProviderLocalCostProfile): boolean {
  return (profile.presetId ?? profile.id).trim() === 'codex'
}

function isPotentialLegacyCodexUsage(
  record: ProviderLocalCostUsageRecord,
  model: string
): boolean {
  const normalized = model.trim().toLowerCase()
  if (/^codex\//u.test(normalized)) return true
  return record.usage.billingKind === 'subscription' && (
    /^openai\//u.test(normalized) || /^gpt-/u.test(normalized)
  )
}

function usageModel(record: ProviderLocalCostUsageRecord): string {
  return record.usage.actualModelId?.trim()
    || record.usage.requestedModelId?.trim()
    || record.model?.trim()
    || 'unknown'
}

function emptyProviderAccumulator(): ProviderAccumulator {
  return { today: emptyWindow(), last30Days: emptyWindow() }
}

function emptyWindow(): CostWindowAccumulator {
  return { requests: 0, totalTokens: 0, estimates: [] }
}

function addRecord(
  window: CostWindowAccumulator,
  record: ProviderLocalCostUsageRecord,
  estimate: CodexSubscriptionValueInput
): void {
  window.requests += requestCount(record)
  const reportedTotal = nonNegativeInteger(record.usage.totalTokens)
  window.totalTokens += reportedTotal ||
    nonNegativeInteger(record.usage.promptTokens) + nonNegativeInteger(record.usage.completionTokens)
  window.estimates.push(estimate)
}

function isModelUsageRecord(record: ProviderLocalCostUsageRecord): boolean {
  return nonNegativeInteger(record.usage.turns ?? 0) > 0 ||
    nonNegativeInteger(record.usage.promptTokens) > 0 ||
    nonNegativeInteger(record.usage.completionTokens) > 0 ||
    nonNegativeInteger(record.usage.totalTokens) > 0
}

function requestCount(record: ProviderLocalCostUsageRecord): number {
  return Math.max(1, nonNegativeInteger(record.usage.turns ?? 0))
}

function finishWindow(window: CostWindowAccumulator): ProviderLocalCostWindow {
  if (window.estimates.length === 0) {
    return {
      requests: 0,
      totalTokens: 0,
      amount: 0,
      coverage: 'complete'
    }
  }
  const aggregate = aggregateCodexReferenceValue(window.estimates)
  return {
    requests: window.requests,
    totalTokens: window.totalTokens,
    amount: aggregate.amountUsd,
    coverage: aggregate.coverage
  }
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function validDate(value: Date | undefined): Date | null {
  return value && Number.isFinite(value.getTime()) ? value : null
}
