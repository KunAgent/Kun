import { metadataEvidence, MODEL_METADATA_FIELDS } from '../contracts/model-metadata-evidence.js'
import type { ModelCapabilityMetadata, ModelReasoningCapabilityMetadata, ModelReasoningEffort, ModelServiceTier } from '../contracts/capabilities-core.js'
import { MAX_MODEL_CONTEXT_WINDOW_TOKENS, MAX_MODEL_OUTPUT_TOKENS } from '../contracts/capabilities-core.js'

export type DiscoveredModelProfile = Partial<Omit<ModelCapabilityMetadata, 'id'>> & {
  name?: string
  metadataIssues?: Array<{ field: string; code: 'invalid'; rawValue?: number }>
}
export type DiscoveredModelDetails = {
  displayName?: string
  description?: string
  aliases?: string[]
  parameters?: Array<{ id: string; displayName?: string; values: Array<{ value: string; displayName?: string }> }>
  variants?: Array<{ displayName: string; isDefault?: boolean; params: Array<{ id: string; value: string }> }>
}
export type ModelDiscoveryResult = {
  models: string[]
  account?: Record<string, string>
  modelProfiles: Record<string, DiscoveredModelProfile>
  modelDetails?: Record<string, DiscoveredModelDetails>
  source: 'provider' | 'manual' | 'preset'
  lastAttemptStatus: 'success' | 'fallback'
  stale?: boolean
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const EFFORTS: Record<string, ModelReasoningEffort> = {
  auto: 'auto', none: 'off', off: 'off', minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'max', max: 'max'
}

/** Preserve wire values separately; choosing max must not turn Codex xhigh into low. */
export function parseNativeReasoning(values: unknown, defaultValue: unknown,
  protocol: ModelReasoningCapabilityMetadata['requestProtocol']): ModelReasoningCapabilityMetadata | undefined {
  if (!Array.isArray(values)) return undefined
  const native = [...new Set(values.slice(0, 32).flatMap((entry) => {
    const value = typeof entry === 'string' ? entry : record(entry).effort
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 64 ? [value] : []
  }))]
  const known = [...new Set(native.flatMap((value) => EFFORTS[value] ? [EFFORTS[value]] : []))]
  const supported: ModelReasoningEffort[] = known.length ? known : ['auto']
  const nativeDefault = typeof defaultValue === 'string' && native.includes(defaultValue) ? defaultValue : undefined
  const mapping = Object.fromEntries(known.map((effort) => [effort,
    nativeDefault && EFFORTS[nativeDefault] === effort ? nativeDefault :
      native.includes(effort) ? effort : [...native].sort().find((value) => EFFORTS[value] === effort)!]))
  return { supportedEfforts: supported, defaultEffort: (nativeDefault && EFFORTS[nativeDefault]) || supported[0],
    requestProtocol: protocol, nativeEfforts: native, ...(nativeDefault ? { nativeDefaultEffort: nativeDefault } : {}), effortMapping: mapping }
}

/** Only explicit provider fields become observations; absent capabilities remain absent. */
export function parseProviderModelDescriptor(value: unknown, protocol: ModelReasoningCapabilityMetadata['requestProtocol'] = 'none'): DiscoveredModelProfile {
  const row = record(value), limits = record(row.limit), profile: DiscoveredModelProfile = {}
  const issues: NonNullable<DiscoveredModelProfile['metadataIssues']> = []
  if (typeof row.name === 'string' && row.name.trim() && row.name.length <= 256) profile.name = row.name.trim()
  const numbers = [
    ['contextWindowTokens', row.context_window ?? row.context_length ?? row.contextWindowTokens ?? limits.context, MAX_MODEL_CONTEXT_WINDOW_TOKENS],
    ['maxInputTokens', row.max_input_tokens ?? row.maxInputTokens ?? limits.input, MAX_MODEL_CONTEXT_WINDOW_TOKENS],
    ['maxOutputTokens', row.max_output_tokens ?? row.maxOutputTokens ?? limits.output, MAX_MODEL_OUTPUT_TOKENS]
  ] as const
  for (const [field, raw, max] of numbers) {
    if (raw === undefined) continue
    if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 && raw <= max) profile[field] = raw
    else issues.push({ field, code: 'invalid', ...(typeof raw === 'number' && Number.isFinite(raw) ? { rawValue: raw } : {}) })
  }
  for (const [field, value] of [
    ['supportsToolCalling', row.supports_tools ?? row.supportsToolCalling ?? row.tool_call],
    ['supportsReasoning', typeof row.supports_reasoning === 'boolean' ? row.supports_reasoning : row.reasoning],
    ['parallelTools', row.parallel_tool_calls], ['streaming', row.streaming], ['structuredOutput', row.structured_output]
  ] as const) if (typeof value === 'boolean') profile[field] = value
  const modalities = record(row.modalities)
  for (const [field, value] of [
    ['inputModalities', row.input_modalities ?? modalities.input],
    ['outputModalities', row.output_modalities ?? modalities.output]
  ] as const) {
    if (!Array.isArray(value)) continue
    const parsed = [...new Set(value.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image'))]
    if (parsed.length || value.length === 0) profile[field] = parsed
  }
  if (profile.inputModalities) profile.messageParts = profile.inputModalities.length === 0 ? [] : profile.inputModalities.includes('image') ? ['text', 'image_url'] : ['text']
  const reasoning = parseNativeReasoning(row.supported_reasoning_levels ?? row.reasoning_efforts,
    row.default_reasoning_level ?? row.default_reasoning_effort, protocol)
  if (reasoning) {
    profile.reasoning = reasoning
    if (profile.supportsReasoning === undefined && reasoning.nativeEfforts?.length) {
      profile.supportsReasoning = reasoning.nativeEfforts.some((effort) => effort !== 'off' && effort !== 'none')
    }
  }
  if (Array.isArray(row.service_tiers)) profile.serviceTiers = [...new Set<ModelServiceTier>(row.service_tiers.flatMap((value) => {
    const id = typeof value === 'string' ? value : record(value).id
    return id === 'priority' || id === 'flex' ? [id as ModelServiceTier] : []
  }))]
  if (issues.length) profile.metadataIssues = issues
  profile.evidence = metadataEvidence(profile, 'provider', new Date().toISOString())
  for (const field of MODEL_METADATA_FIELDS) if (profile[field] !== undefined) {
    const fact = profile.evidence[field]!
    fact.sourceId = 'provider-models'; fact.match = 'exact'
    const paths: Record<string, string[]> = { contextWindowTokens: ['context_window', 'context_length', 'contextWindowTokens'],
      maxInputTokens: ['max_input_tokens', 'maxInputTokens'], maxOutputTokens: ['max_output_tokens', 'maxOutputTokens'],
      reasoning: ['supported_reasoning_levels', 'reasoning_efforts'], supportsReasoning: ['supports_reasoning', 'reasoning'],
      supportsToolCalling: ['supports_tools', 'supportsToolCalling', 'tool_call'] }
    fact.fieldPath = paths[field]?.find((path) => field === 'reasoning' ? Array.isArray(row[path]) : row[path] === profile[field]) ??
      (field === 'contextWindowTokens' ? 'limit.context' : field === 'maxInputTokens' ? 'limit.input' : field === 'maxOutputTokens' ? 'limit.output' : field)
  }
  return profile
}

const CODEX_DEFAULT_REASONING_LEVELS = ['low', 'medium', 'high', 'xhigh']

export function parseCodexModelDescriptors(body: string): ModelDiscoveryResult {
  const root = record(JSON.parse(body))
  if (!Array.isArray(root.models)) throw new Error('Invalid Codex catalog')
  const profiles: Record<string, DiscoveredModelProfile> = Object.create(null)
  for (const value of root.models.slice(0, 2_000)) {
    const row = record(value)
    if (typeof row.slug !== 'string' || row.visibility !== 'list') continue
    const id = row.slug.trim()
    if (!id || id.length > 512 || profiles[id]) continue
    const profile = parseProviderModelDescriptor(row, 'openai-responses')
    if (row.use_responses_lite === true) profile.responsesMode = 'lite'
    // Newer catalog rows can omit the level list; Responses accepts these for every listed model, so don't leave the picker on Auto alone.
    if (!profile.reasoning && profile.supportsReasoning !== false) {
      profile.reasoning = parseNativeReasoning(CODEX_DEFAULT_REASONING_LEVELS, 'medium', 'openai-responses')
      profile.supportsReasoning ??= true
      profile.evidence!.reasoning = { source: 'adapter', status: 'declared', sourceId: 'codex-models', fieldPath: 'default_reasoning_levels', match: 'exact', observedAt: new Date().toISOString() }
    }
    if (typeof row.max_context_window === 'number' && Number.isSafeInteger(row.max_context_window) &&
        row.max_context_window > (profile.contextWindowTokens ?? 0) && row.max_context_window <= MAX_MODEL_CONTEXT_WINDOW_TOKENS) {
      profile.conditionalCapabilities = [{ condition: 'provider-extension', contextWindowTokens: row.max_context_window }]
    }
    if (profile.conditionalCapabilities) profile.evidence!.conditionalCapabilities = { source: 'provider', status: 'declared', sourceId: 'codex-models', fieldPath: 'max_context_window', match: 'exact', observedAt: new Date().toISOString() }
    profiles[id] = profile
  }
  return { models: Object.keys(profiles), modelProfiles: profiles, source: 'provider', lastAttemptStatus: 'success' }
}
