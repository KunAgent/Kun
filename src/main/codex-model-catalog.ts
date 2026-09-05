import type { ModelProviderModelProfileV1, ModelReasoningEffort } from '../shared/app-settings'

/** Codex uses slugs and picker visibility rather than the public API's data[].id. */
export function parseCodexModelCatalog(body: string): {
  modelIds: string[]
  modelProfiles: Record<string, ModelProviderModelProfileV1>
} {
  const catalog = JSON.parse(body)
  if (!catalog || !Array.isArray(catalog.models)) throw new Error('Invalid Codex catalog')
  const profiles = new Map<string, ModelProviderModelProfileV1>()
  for (const row of catalog.models.slice(0, 2_000)) {
    if (!row || typeof row.slug !== 'string' || row.visibility !== 'list') continue
    const id = row.slug.trim()
    if (!id || id.length > 512 || profiles.has(id)) continue
    // supported_in_api is not an entitlement filter for ChatGPT subscription models (e.g. Spark).
    const vision = Array.isArray(row.input_modalities) && row.input_modalities.includes('image')
    const efforts: ModelReasoningEffort[] = Array.isArray(row.supported_reasoning_levels)
      ? [...new Set<ModelReasoningEffort>(row.supported_reasoning_levels.flatMap((level: { effort?: string } | null) => {
          const effort = level?.effort
          return effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'max'
            ? [effort] : []
        }))]
      : []
    const defaultEffort = efforts.includes(row.default_reasoning_level)
      ? row.default_reasoning_level : efforts[0]
    profiles.set(id, {
      inputModalities: vision ? ['text', 'image'] : ['text'],
      outputModalities: ['text'],
      messageParts: vision ? ['text', 'image_url'] : ['text'],
      supportsToolCalling: true,
      ...(Number.isSafeInteger(row.context_window) && row.context_window > 0
        ? { contextWindowTokens: row.context_window } : {}),
      ...(row.use_responses_lite === true ? { responsesMode: 'lite' as const } : {}),
      ...(Array.isArray(row.service_tiers) && row.service_tiers.some((tier: { id?: string } | null) => tier?.id === 'priority')
        ? { serviceTiers: ['priority'] } : {}),
      ...(defaultEffort ? { reasoning: {
        supportedEfforts: efforts, defaultEffort, requestProtocol: 'openai-responses' as const
      } } : {})
    })
  }
  return { modelIds: [...profiles.keys()], modelProfiles: Object.fromEntries(profiles) }
}
