import type { ProviderQuotaMetric } from '../contracts/provider-quota.js'

type PoolDescriptor = {
  id: string
  label: string
  order: number
}

function normalizeModelText(value: string): string {
  return value.toLowerCase().replace(/[-_./]+/g, ' ').replace(/\s+/g, ' ').trim()
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
