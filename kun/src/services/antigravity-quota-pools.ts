import type { ProviderQuotaMetric } from '../contracts/provider-quota.js'
import { clampPercentage, isoDateValue, numberValue, optionalRecord, stringValue } from './provider-subscription-quota-support.js'

type PoolDescriptor = {
  id: string
  label: string
  order: number
}

type WindowDescriptor = {
  title: string
  windowSeconds?: number
  order: number
}

const FIVE_HOURS_SECONDS = 5 * 3_600
const ONE_WEEK_SECONDS = 7 * 24 * 3_600

function normalizeModelText(value: string): string {
  return value.toLowerCase().replace(/[-_./]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function classifyGroupOrder(groupTitle: string, index: number): number {
  if (/\bgemini\b/i.test(groupTitle)) return 1
  if (/\b(?:claude|gpt|3p)\b/i.test(groupTitle)) return 2
  return 10 + index
}

function classifySummaryWindow(
  bucketId: string,
  rawWindow: string,
  displayName: string
): WindowDescriptor {
  if (
    /^(?:weekly|7d|1w)$/i.test(rawWindow) ||
    /-weekly$/i.test(bucketId) ||
    /\bweekly\b/i.test(displayName)
  ) {
    return { title: 'Weekly limit', windowSeconds: ONE_WEEK_SECONDS, order: 1 }
  }
  if (
    /^5h$/i.test(rawWindow) ||
    /-5h$/i.test(bucketId) ||
    /\b(?:5\s*h|five[\s-]*hour)\b/i.test(displayName)
  ) {
    return { title: '5h limit', windowSeconds: FIVE_HOURS_SECONDS, order: 2 }
  }
  const hourMatch = rawWindow.match(/^(\d+)\s*h$/i)
  if (hourMatch) {
    const hours = Number(hourMatch[1])
    return { title: `${hours}h limit`, windowSeconds: hours * 3_600, order: 3 }
  }
  const dayMatch = rawWindow.match(/^(\d+)\s*d$/i)
  if (dayMatch) {
    const days = Number(dayMatch[1])
    return {
      title: days === 7 ? 'Weekly limit' : `${days}d limit`,
      windowSeconds: days * 86_400,
      order: days === 7 ? 1 : 4
    }
  }
  const cleaned = displayName.replace(/\bremaining\b/gi, '').replace(/\s+/g, ' ').trim()
  return { title: cleaned || rawWindow || 'Limit', order: 5 }
}

/**
 * Parses Antigravity 2.0 grouped quota summaries (`aicode.googleapis.com/v1alpha:fetchQuotaStatus`
 * or `cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`) into grouped
 * Weekly and 5h limit metrics (`<Group> · Weekly limit`, `<Group> · 5h limit`).
 */
export function parseAntigravityQuotaSummary(payload: unknown): ProviderQuotaMetric[] {
  const root = optionalRecord(payload)
  if (!root) return []
  const summaryRecord = optionalRecord(root.quotaSummary)
  const rawGroups = Array.isArray(summaryRecord?.groups)
    ? summaryRecord.groups
    : Array.isArray(root.groups)
      ? root.groups
      : []
  if (rawGroups.length === 0) return []

  const parsedGroups: Array<{
    order: number
    metrics: ProviderQuotaMetric[]
  }> = []

  rawGroups.forEach((groupValue, groupIndex) => {
    const group = optionalRecord(groupValue)
    if (!group) return
    const groupTitle = stringValue(group.displayName) || `Group ${groupIndex + 1}`
    const groupSlug = groupTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `group-${groupIndex + 1}`
    const rawBuckets = Array.isArray(group.buckets) ? group.buckets : []
    const bucketEntries: Array<{ order: number; metric: ProviderQuotaMetric }> = []

    rawBuckets.forEach((bucketValue, bucketIndex) => {
      const bucket = optionalRecord(bucketValue)
      if (!bucket || bucket.isDisabled === true) return
      const remainingFraction = numberValue(bucket.remainingFraction)
      if (remainingFraction === undefined) return
      const bucketId = stringValue(bucket.bucketId) || `${groupSlug}-${bucketIndex}`
      const rawWindow = stringValue(bucket.refreshWindowLabel) || stringValue(bucket.window)
      const displayName = stringValue(bucket.displayName)
      const windowDesc = classifySummaryWindow(bucketId, rawWindow, displayName)
      const remainingPercent = clampPercentage(remainingFraction * 100)
      const usedPercent = Math.round((100 - remainingPercent) * 100) / 100
      const hasActiveWindow = remainingFraction < 1 || Boolean(stringValue(bucket.description))
      const resetsAt = hasActiveWindow ? isoDateValue(bucket.resetTime) : undefined

      bucketEntries.push({
        order: windowDesc.order,
        metric: {
          id: bucketId,
          label: `${groupTitle} · ${windowDesc.title}`,
          unit: 'percent',
          usedPercent,
          ...(windowDesc.windowSeconds !== undefined ? { windowSeconds: windowDesc.windowSeconds } : {}),
          ...(resetsAt ? { resetsAt } : {})
        }
      })
    })

    if (bucketEntries.length > 0) {
      bucketEntries.sort((left, right) => left.order - right.order)
      parsedGroups.push({
        order: classifyGroupOrder(groupTitle, groupIndex),
        metrics: bucketEntries.map((entry) => entry.metric)
      })
    }
  })

  return parsedGroups
    .sort((left, right) => left.order - right.order)
    .flatMap((group) => group.metrics)
}

export function mergeAntigravitySummaryWithBuckets(
  summaryMetrics: readonly ProviderQuotaMetric[],
  perModelMetrics: readonly ProviderQuotaMetric[]
): ProviderQuotaMetric[] {
  if (summaryMetrics.length === 0) {
    return mergeAntigravityQuotaPools(perModelMetrics)
  }
  const hasGeminiGroup = summaryMetrics.some((metric) => /\bgemini\b/i.test(metric.label))
  if (hasGeminiGroup || perModelMetrics.length === 0) {
    return [...summaryMetrics]
  }
  const geminiBuckets = perModelMetrics.filter((metric) =>
    /\bgemini\b/i.test(`${metric.label} ${metric.id}`) &&
    !/\b(?:image|imagen)\b/i.test(`${metric.label} ${metric.id}`)
  )
  if (geminiBuckets.length === 0) {
    return [...summaryMetrics]
  }
  let usedPercent = 0
  let resetsAt: string | undefined
  for (const metric of geminiBuckets) {
    const incomingUsed = typeof metric.usedPercent === 'number' && Number.isFinite(metric.usedPercent)
      ? metric.usedPercent
      : 0
    resetsAt = pickPoolReset({ usedPercent, resetsAt }, incomingUsed, metric.resetsAt)
    usedPercent = Math.max(usedPercent, incomingUsed)
  }
  const geminiFiveHour: ProviderQuotaMetric = {
    id: 'gemini-5h',
    label: 'Gemini Models · 5h limit',
    unit: 'percent',
    usedPercent,
    windowSeconds: FIVE_HOURS_SECONDS,
    ...(usedPercent > 0 && resetsAt ? { resetsAt } : {})
  }
  return [geminiFiveHour, ...summaryMetrics]
}

function classifyAntigravityQuotaPool(metric: ProviderQuotaMetric): PoolDescriptor {
  const normalized = normalizeModelText(`${metric.label} ${metric.id}`)
  if (/\bclaude\b/.test(normalized)) {
    return { id: 'pool-claude', label: 'Claude', order: 2 }
  }
  if (/\bgpt\s*oss\b/.test(normalized)) {
    return { id: 'pool-gpt-oss', label: 'GPT-OSS', order: 5 }
  }
  if (/\b(?:gemini\b.*\bimage|imagen)\b/.test(normalized)) {
    return { id: 'pool-gemini-image', label: 'Gemini Image', order: 6 }
  }
  if (/\bgemini\b.*\bflash\s*lite\b/.test(normalized)) {
    return { id: 'pool-gemini-flash-lite', label: 'Gemini Flash-Lite', order: 4 }
  }
  if (/\bgemini\b.*\bflash\b/.test(normalized)) {
    return { id: 'pool-gemini-flash', label: 'Gemini Flash', order: 3 }
  }
  if (/\bgemini\b.*\bpro\b/.test(normalized)) {
    return { id: 'pool-gemini-pro', label: 'Gemini Pro', order: 1 }
  }
  const baseLabel = metric.label.trim() || metric.id.trim()
  const slug = baseLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return {
    id: `pool-${slug || 'other'}`,
    label: baseLabel,
    order: 10
  }
}

function pickPoolReset(
  current: { usedPercent: number; resetsAt?: string },
  incomingUsed: number,
  incomingReset?: string
): string | undefined {
  if (!incomingReset) return current.resetsAt
  if (!current.resetsAt) return incomingReset
  if (incomingUsed > current.usedPercent) return incomingReset
  if (incomingUsed < current.usedPercent) return current.resetsAt
  return Date.parse(incomingReset) < Date.parse(current.resetsAt)
    ? incomingReset
    : current.resetsAt
}

/**
 * Collapses Antigravity per-model quota buckets into their shared model-family
 * pools so the quota card stays scannable and surfaces the tightest pool first.
 */
export function mergeAntigravityQuotaPools(
  metrics: readonly ProviderQuotaMetric[]
): ProviderQuotaMetric[] {
  const pools = new Map<string, {
    descriptor: PoolDescriptor
    usedPercent: number
    resetsAt?: string
  }>()
  for (const metric of metrics) {
    const descriptor = classifyAntigravityQuotaPool(metric)
    const usedPercent = typeof metric.usedPercent === 'number' && Number.isFinite(metric.usedPercent)
      ? metric.usedPercent
      : 0
    const existing = pools.get(descriptor.id)
    if (!existing) {
      pools.set(descriptor.id, {
        descriptor,
        usedPercent,
        ...(metric.resetsAt ? { resetsAt: metric.resetsAt } : {})
      })
      continue
    }
    const nextReset = pickPoolReset(existing, usedPercent, metric.resetsAt)
    pools.set(descriptor.id, {
      descriptor,
      usedPercent: Math.max(existing.usedPercent, usedPercent),
      ...(nextReset ? { resetsAt: nextReset } : {})
    })
  }
  return [...pools.values()]
    .sort((left, right) =>
      right.usedPercent - left.usedPercent ||
      left.descriptor.order - right.descriptor.order ||
      left.descriptor.label.localeCompare(right.descriptor.label)
    )
    .map((pool) => ({
      id: pool.descriptor.id,
      label: pool.descriptor.label,
      unit: 'percent',
      usedPercent: pool.usedPercent,
      ...(pool.resetsAt ? { resetsAt: pool.resetsAt } : {})
    }))
}
