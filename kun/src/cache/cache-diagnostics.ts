import type { UsageSnapshot } from '../contracts/usage.js'

export type CacheRequestSignature = {
  model: string
  providerId: string
  endpointFormat: string
  prefixFingerprint: string
  toolCatalogFingerprint: string
  activeSkillIds: string[]
}

export type CacheMissReason =
  | 'cold_request'
  | 'model_changed'
  | 'provider_changed'
  | 'endpoint_changed'
  | 'stable_prefix_changed'
  | 'tool_catalog_changed'
  | 'skills_changed'
  | 'cache_ttl_unknown'
  | 'provider_cache_miss'
  | 'provider_metrics_unavailable'

export type CacheDiagnostic = {
  cacheableTokenHitRate: number | null
  totalInputTokenHitRate: number | null
  reasons: CacheMissReason[]
  suggestions: string[]
}

export function diagnoseCacheUsage(input: {
  usage: Pick<UsageSnapshot, 'promptTokens' | 'cacheHitTokens' | 'cacheMissTokens'>
  previous?: CacheRequestSignature
  current: CacheRequestSignature
}): CacheDiagnostic {
  const hitTokens = input.usage.cacheHitTokens
  const missTokens = input.usage.cacheMissTokens
  // Require BOTH hit and miss counters before trusting provider telemetry.
  // A provider that reports only hits (miss undefined) — or only misses —
  // gives partial data; treating that as complete would mask the miss-reason
  // branch and falsely report perfect cache coverage.
  const hasProviderMetrics = hitTokens !== undefined && missTokens !== undefined
  const cacheableTokens = (hitTokens ?? 0) + (missTokens ?? 0)
  const reasons: CacheMissReason[] = []
  const suggestions: string[] = []

  if (!input.previous) {
    reasons.push('cold_request')
  } else {
    if (input.previous.model !== input.current.model) reasons.push('model_changed')
    if (input.previous.providerId !== input.current.providerId) reasons.push('provider_changed')
    if (input.previous.endpointFormat !== input.current.endpointFormat) reasons.push('endpoint_changed')
    if (input.previous.prefixFingerprint !== input.current.prefixFingerprint) reasons.push('stable_prefix_changed')
    if (input.previous.toolCatalogFingerprint !== input.current.toolCatalogFingerprint) {
      reasons.push('tool_catalog_changed')
      suggestions.push('The available tool catalog changed. Keep MCP and Skill tools stable within a thread.')
    }
    if (!sameStrings(input.previous.activeSkillIds, input.current.activeSkillIds)) {
      reasons.push('skills_changed')
      suggestions.push('The active Skill set changed. Reuse a stable Skill set for cache-sensitive turns.')
    }
  }
  if (!hasProviderMetrics) {
    reasons.push('provider_metrics_unavailable')
    suggestions.push('This provider did not report cache hit/miss tokens, so cache effectiveness cannot be verified.')
  } else if ((missTokens ?? 0) > 0 && (hitTokens ?? 0) === 0) {
    reasons.push('provider_cache_miss')
    reasons.push('cache_ttl_unknown')
  }
  if (reasons.includes('model_changed') || reasons.includes('provider_changed') || reasons.includes('endpoint_changed')) {
    suggestions.push('Keep the model and provider unchanged while warming a conversation cache.')
  }
  if (reasons.includes('stable_prefix_changed')) {
    suggestions.push('Keep timestamps, workspace snippets, and other volatile data out of the stable prefix.')
  }
  if (reasons.includes('cache_ttl_unknown')) {
    suggestions.push('Provider cache TTL may have expired or the provider declined to reuse the prefix.')
  }

  return {
    // Only report a cacheable hit rate when both hit and miss counters are
    // present; partial telemetry (e.g. hits only) would otherwise compute a
    // misleading 1.0 "perfect" rate from an incomplete denominator.
    cacheableTokenHitRate:
      hasProviderMetrics && cacheableTokens > 0 ? (hitTokens ?? 0) / cacheableTokens : null,
    totalInputTokenHitRate:
      hasProviderMetrics && input.usage.promptTokens > 0 && hitTokens !== undefined
        ? hitTokens / input.usage.promptTokens
        : null,
    reasons: [...new Set(reasons)],
    suggestions: [...new Set(suggestions)]
  }
}

function sameStrings(left: readonly string[] | undefined, right: readonly string[]): boolean {
  if (!left) return right.length === 0
  if (left.length !== right.length) return false
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return sortedLeft.every((value, index) => value === sortedRight[index])
}
