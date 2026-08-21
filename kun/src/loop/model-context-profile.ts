import type {
  ModelCapabilityMetadata,
  ModelInputModality,
  ModelMessagePartSupport,
  ModelReasoningCapabilityMetadata
} from '../contracts/capabilities.js'
import type { ModelEndpointFormat } from '../contracts/model-endpoint-format.js'

export type ModelContextThresholds = {
  softThreshold: number
  hardThreshold: number
}

export type ModelContextCompactionProfileConfig = {
  softRatio?: number
  hardRatio?: number
  softThreshold?: number
  hardThreshold?: number
}

export type ModelContextProfile = ModelContextThresholds & {
  canonicalModel: string
  modelIds: readonly string[]
  contextWindowTokens: number
  maxOutputTokens?: number
  inputModalities: readonly ModelInputModality[]
  outputModalities: readonly ModelInputModality[]
  supportsToolCalling: boolean
  messageParts: readonly ModelMessagePartSupport[]
  reasoning?: ModelReasoningCapabilityMetadata
  serviceTiers?: readonly ('priority' | 'flex')[]
  endpointFormat?: ModelEndpointFormat
  responsesMode?: 'lite'
}

export type ModelContextProfileConfig = {
  aliases?: readonly string[]
  contextWindowTokens?: number
  maxOutputTokens?: number
  contextCompaction?: ModelContextCompactionProfileConfig
  /** @deprecated Use contextCompaction.softRatio. */
  softRatio?: number
  /** @deprecated Use contextCompaction.hardRatio. */
  hardRatio?: number
  /** @deprecated Use contextCompaction.softThreshold. */
  softThreshold?: number
  /** @deprecated Use contextCompaction.hardThreshold. */
  hardThreshold?: number
  inputModalities?: readonly ModelInputModality[]
  outputModalities?: readonly ModelInputModality[]
  supportsToolCalling?: boolean
  messageParts?: readonly ModelMessagePartSupport[]
  reasoning?: ModelReasoningCapabilityMetadata
  serviceTiers?: readonly ('priority' | 'flex')[]
  endpointFormat?: ModelEndpointFormat
  responsesMode?: 'lite'
}

export type ModelConfig = {
  profiles?: Record<string, ModelContextProfileConfig>
}

export type ContextCompactionConfig = {
  defaultSoftThreshold?: number
  defaultHardThreshold?: number
  summaryMode?: 'heuristic' | 'model'
  summaryTimeoutMs?: number
  summaryMaxTokens?: number
  summaryInputMaxBytes?: number
  /** Optional model override for compaction summary (empty = follow main model). */
  summaryModel?: string
  /** Provider id paired with summaryModel. */
  summaryProviderId?: string
  /**
   * @deprecated Model-specific context windows and compaction thresholds belong
   * in top-level models.profiles. This field is still read for compatibility.
   */
  modelProfiles?: Record<string, ModelContextProfileConfig>
}

export type ModelProfileConfigSource = {
  models?: ModelConfig
  contextCompaction?: ContextCompactionConfig
}

export type ProviderModelCapabilityInput = {
  providerId?: string
  presetSource?: string
  baseUrl?: string
  kind?:
    | 'http'
    | 'agent-sdk'
    | 'antigravity-cli'
    | 'cursor-sdk'
    | 'gemini-cli-api'
    | 'gemini-code-assist'
  model?: string
}

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 256_000

export const DEFAULT_CONTEXT_THRESHOLDS: ModelContextThresholds = {
  // Fallback for models without a registered profile. These assume a
  // reasonably large window (>=256k). A custom endpoint with a small
  // window (e.g. 32k) should register a profile with explicit thresholds,
  // otherwise it may exceed its window before the first compaction.
  softThreshold: 192_000,
  hardThreshold: 217_600
}

const DEEPSEEK_V4_CONTEXT_WINDOW_TOKENS = 1_000_000
// Trigger compaction well before the real window is full. Compacting at
// ~98% (the previous default) left no headroom: a single large tool
// result could blow past the window before the next compaction ran,
// which is what caused runaway context growth and dropped tool tables.
// 0.75 / 0.85 mirrors the "compact before 100%" guidance used by mature
// coding agents and leaves room for the post-compaction request to fit.
const DEEPSEEK_V4_SOFT_THRESHOLD_RATIO = 0.75
const DEEPSEEK_V4_HARD_THRESHOLD_RATIO = 0.85
const GLM_REASONING: ModelReasoningCapabilityMetadata = {
  supportedEfforts: ['off', 'high', 'max'],
  defaultEffort: 'max',
  requestProtocol: 'glm-chat-completions'
}
const CODEX_RESPONSES_REASONING: ModelReasoningCapabilityMetadata = {
  supportedEfforts: ['low', 'medium', 'high', 'max'],
  defaultEffort: 'high',
  requestProtocol: 'openai-responses'
}
const CODEX_PRIORITY_SERVICE_TIER_MODELS = new Set([
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4'
])
const DEFAULT_MODEL_INPUT_MODALITIES: readonly ModelInputModality[] = ['text']
const DEFAULT_MODEL_OUTPUT_MODALITIES: readonly ModelInputModality[] = ['text']
const DEFAULT_MODEL_MESSAGE_PARTS: readonly ModelMessagePartSupport[] = ['text']

export const MODEL_CONTEXT_PROFILES: readonly ModelContextProfile[] = [
  deepseekV4Profile('deepseek-v4-pro', ['deepseek-v4-pro']),
  deepseekV4Profile('deepseek-v4-flash', [
    'deepseek-v4-flash',
    // Back-compat aliases currently routed by DeepSeek to v4-flash modes.
    'deepseek-chat',
    'deepseek-reasoner'
  ]),
  glmReasoningProfile('glm-5.2', 1_000_000),
  glmReasoningProfile('glm-5.1', 200_000),
  glmReasoningProfile('glm-5', 200_000),
  glmReasoningProfile('glm-5-turbo', 200_000),
  glmReasoningProfile('glm-4.7', 200_000),
  glmReasoningProfile('glm-4.5-air', 200_000),
  codexReasoningProfile('gpt-5.6-sol', 372_000, true),
  codexReasoningProfile('gpt-5.6-terra', 372_000, true),
  codexReasoningProfile('gpt-5.6-luna', 372_000, true),
  codexReasoningProfile('gpt-5.5', 1_000_000),
  codexReasoningProfile('gpt-5.4', 1_000_000),
  codexReasoningProfile('gpt-5.4-mini', 1_000_000),
  codexReasoningProfile('gpt-5.3-codex-spark', 128_000, false, false)
]

export function resolveModelContextProfile(
  model: string | undefined,
  profiles: readonly ModelContextProfile[] = MODEL_CONTEXT_PROFILES
): ModelContextProfile | null {
  const normalized = normalizeModelId(model)
  if (!normalized) return null
  return profiles.find((profile) =>
    profile.modelIds.some((modelId) => normalized === modelId || normalized.endsWith(`/${modelId}`))
  ) ?? null
}

export function contextThresholdsForModel(
  model: string | undefined,
  fallback: ModelContextThresholds = DEFAULT_CONTEXT_THRESHOLDS,
  profiles: readonly ModelContextProfile[] = MODEL_CONTEXT_PROFILES
): ModelContextThresholds {
  const profile = resolveModelContextProfile(model, profiles)
  if (!profile) return fallback
  // Safety cap: never let thresholds exceed 75%/85% of the context
  // window, even if a config-provided model profile sets them higher
  // (e.g. 98%/99%). Compacting too late leaves no headroom and lets a
  // single large turn blow past the real window, causing runaway growth.
  const maxSoft = profile.contextWindowTokens
    ? Math.floor(profile.contextWindowTokens * 0.75)
    : profile.softThreshold
  const maxHard = profile.contextWindowTokens
    ? Math.floor(profile.contextWindowTokens * 0.85)
    : profile.hardThreshold
  return {
    softThreshold: Math.min(profile.softThreshold, maxSoft),
    hardThreshold: Math.min(profile.hardThreshold, maxHard)
  }
}

export function modelCapabilitiesForModel(
  model: string | undefined,
  profiles: readonly ModelContextProfile[] = MODEL_CONTEXT_PROFILES
): ModelCapabilityMetadata {
  const profile = resolveModelContextProfile(model, profiles)
  return {
    id: model?.trim() || profile?.canonicalModel || 'auto',
    inputModalities: [...(profile?.inputModalities ?? DEFAULT_MODEL_INPUT_MODALITIES)],
    outputModalities: [...(profile?.outputModalities ?? DEFAULT_MODEL_OUTPUT_MODALITIES)],
    supportsToolCalling: profile?.supportsToolCalling ?? true,
    contextWindowTokens: profile?.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
    ...(profile?.maxOutputTokens ? { maxOutputTokens: profile.maxOutputTokens } : {}),
    messageParts: [...(profile?.messageParts ?? DEFAULT_MODEL_MESSAGE_PARTS)],
    ...(profile?.reasoning ? { reasoning: copyReasoningCapability(profile.reasoning) } : {}),
    ...(profile?.serviceTiers ? { serviceTiers: [...profile.serviceTiers] } : {}),
    ...(profile?.endpointFormat ? { endpointFormat: profile.endpointFormat } : {}),
    ...(profile?.responsesMode ? { responsesMode: profile.responsesMode } : {})
  }
}

/**
 * Compatibility capabilities for provider catalogs written before
 * `modelCapabilities` became part of the shared runtime config. Explicit
 * provider profiles must be applied by the caller before this fallback.
 *
 * Keep this allowlist provider-aware: identical model ids can use different
 * reasoning fields when they are served by a first-party API or an aggregator.
 */
export function modelCapabilitiesForProviderModel(
  input: ProviderModelCapabilityInput,
  profiles: readonly ModelContextProfile[] = MODEL_CONTEXT_PROFILES
): ModelCapabilityMetadata {
  const model = input.model?.trim()
  const builtIn = modelCapabilitiesForModel(model, profiles)
  const reasoning = providerReasoningCapability(input)
  const serviceTiers = providerServiceTiers(input)
  return {
    ...builtIn,
    ...(reasoning ? { reasoning: copyReasoningCapability(reasoning) } : {}),
    ...(serviceTiers ? { serviceTiers } : {})
  }
}

function providerServiceTiers(
  input: ProviderModelCapabilityInput
): ('priority' | 'flex')[] | undefined {
  const presetSource = input.presetSource?.trim().toLowerCase() ?? ''
  const providerId = input.providerId?.trim().toLowerCase() ?? ''
  const codexSubscription =
    presetSource === 'codex' ||
    (!presetSource && /^codex(?:-\d+)?$/.test(providerId))
  if (!codexSubscription) return undefined
  const model = normalizeModelId(input.model).split('/').at(-1) ?? ''
  return CODEX_PRIORITY_SERVICE_TIER_MODELS.has(model) ? ['priority'] : undefined
}

export function safeProviderReasoningCapability(
  input: ProviderModelCapabilityInput,
  reasoningCapability: ModelReasoningCapabilityMetadata | undefined
): ModelReasoningCapabilityMetadata | undefined {
  const providerId = input.providerId?.trim().toLowerCase() ?? ''
  const presetSource = input.presetSource?.trim().toLowerCase() ?? ''
  const openCodeGo = presetSource === 'opencode-go' || /^opencode-go(?:-\d+)?$/u.test(providerId)
  if (!openCodeGo || reasoningCapability?.requestProtocol !== 'thinking-toggle-chat-completions') {
    return reasoningCapability
  }
  // OpenCode Go's aggregate endpoint does not advertise the generic thinking
  // toggle. Keeping this safety repair provider-scoped preserves explicit
  // thinking-toggle support for unrelated custom HTTP providers.
  return reasoning(['auto'], 'auto', 'none')
}

function providerReasoningCapability(
  input: ProviderModelCapabilityInput
): ModelReasoningCapabilityMetadata | undefined {
  const provider = `${input.providerId ?? ''} ${input.presetSource ?? ''}`.trim().toLowerCase()
  const model = normalizeModelId(input.model)
  const endpoint = parseProviderEndpoint(input.baseUrl)

  if (
    (input.kind === 'agent-sdk' || provider.includes('claude-subscription')) &&
    (model.includes('claude-opus-4-8') || model.includes('claude-sonnet-4-6'))
  ) {
    return reasoning(['low', 'medium', 'high', 'max'], 'high', 'anthropic-thinking')
  }
  if (isKimiK3Model(model, provider)) {
    return reasoning(['low', 'high', 'max'], 'high', 'openai-chat-completions')
  }
  if (
    (provider.includes('grok-subscription') || providerHostMatches(endpoint, 'cli-chat-proxy.grok.com')) &&
    (model === 'grok-4.5' || model.endsWith('/grok-4.5'))
  ) {
    return reasoning(['low', 'medium', 'high'], 'high', 'openai-responses')
  }
  if (
    (provider.includes('opencode-go') ||
      (providerHostMatches(endpoint, 'opencode.ai') && endpointPathStartsWith(endpoint, '/zen/go/'))) &&
    (model === 'grok-4.5' || model.endsWith('/grok-4.5'))
  ) {
    return reasoning(['low', 'medium', 'high'], 'medium', 'openai-chat-completions')
  }
  if (
    (provider.includes('xiaomi') || providerHostMatches(endpoint, 'xiaomimimo.com')) &&
    model.includes('mimo-')
  ) {
    return reasoning(['off', 'low', 'medium', 'high'], 'high', 'mimo-chat-completions')
  }
  if (
    (provider.includes('minimax') || providerHostMatches(endpoint, 'minimaxi.com') ||
      providerHostMatches(endpoint, 'minimax.io')) &&
    model.includes('minimax-m3')
  ) {
    return reasoning(['auto', 'off'], 'auto', 'anthropic-thinking')
  }
  if (
    (provider.includes('aliyun') || providerHostMatches(endpoint, 'dashscope.aliyuncs.com') ||
      providerHostMatches(endpoint, 'maas.aliyuncs.com')) &&
    (model.includes('qwq') || model.includes('qwen3-vl'))
  ) {
    return reasoning(['auto', 'off'], 'auto', 'qwen-chat-completions')
  }
  if (
    (provider.includes('tencentcloud') || providerHostMatches(endpoint, 'hunyuan.cloud.tencent.com') ||
      providerHostMatches(endpoint, 'lkeap.cloud.tencent.com')) &&
    model.includes('hunyuan-t1')
  ) {
    return reasoning(['auto', 'off'], 'auto', 'thinking-toggle-chat-completions')
  }
  if (
    (provider.includes('volcengine') || providerHostMatches(endpoint, 'volces.com')) &&
    model.includes('doubao-')
  ) {
    return reasoning(['auto', 'off'], 'auto', 'thinking-toggle-chat-completions')
  }
  if (
    (provider === 'zenmux' || provider.includes('zenmux') || providerHostMatches(endpoint, 'zenmux.ai')) &&
    isKnownZenMuxReasoningModel(model)
  ) {
    return reasoning(['low', 'medium', 'high'], 'medium', 'openai-chat-completions')
  }
  return undefined
}

function parseProviderEndpoint(value: string | undefined): URL | undefined {
  const normalized = value?.trim()
  if (!normalized) return undefined
  try {
    const endpoint = new URL(normalized)
    return endpoint.protocol === 'https:' || endpoint.protocol === 'http:'
      ? endpoint
      : undefined
  } catch {
    return undefined
  }
}

function providerHostMatches(endpoint: URL | undefined, expected: string): boolean {
  const hostname = endpoint?.hostname.toLowerCase().replace(/\.$/u, '')
  return hostname === expected || hostname?.endsWith(`.${expected}`) === true
}

function endpointPathStartsWith(endpoint: URL | undefined, prefix: string): boolean {
  return endpoint?.pathname.toLowerCase().startsWith(prefix) === true
}

function reasoning(
  supportedEfforts: ModelReasoningCapabilityMetadata['supportedEfforts'],
  defaultEffort: ModelReasoningCapabilityMetadata['defaultEffort'],
  requestProtocol: ModelReasoningCapabilityMetadata['requestProtocol']
): ModelReasoningCapabilityMetadata {
  return { supportedEfforts, defaultEffort, requestProtocol }
}

function isKnownZenMuxReasoningModel(model: string): boolean {
  if (model.includes('non-reasoning')) return false
  return [
    'deepseek-chat',
    'deepseek-reasoner',
    'deepseek-r1',
    'deepseek-v3.2',
    'deepseek-v4',
    'glm-4.5',
    'glm-4.6',
    'glm-4.7',
    'glm-5',
    'grok-3-mini',
    'grok-4',
    'kimi-k2',
    'qwen3',
    'qwq',
    'o1',
    'o3',
    'o4',
    'gpt-5'
  ].some((needle) => model.includes(needle))
}

export function modelContextProfilesFromConfig(
  config?: ContextCompactionConfig | ModelConfig | ModelProfileConfigSource
): readonly ModelContextProfile[] {
  const byCanonical = new Map<string, ModelContextProfile>()
  for (const profile of MODEL_CONTEXT_PROFILES) {
    byCanonical.set(normalizeModelId(profile.canonicalModel), profile)
  }
  const profileGroups = modelProfileGroupsFromConfig(config)
  if (profileGroups.length === 0) return [...byCanonical.values()]
  for (const profiles of profileGroups) {
    for (const [modelId, rawProfile] of Object.entries(profiles)) {
      const canonicalModel = normalizeModelId(modelId)
      if (!canonicalModel) continue
      const current = byCanonical.get(canonicalModel)
      const next = mergeModelContextProfile(canonicalModel, current, rawProfile)
      byCanonical.set(canonicalModel, next)
    }
  }
  return [...byCanonical.values()]
}

function deepseekV4Profile(
  canonicalModel: string,
  modelIds: readonly string[]
): ModelContextProfile {
  return {
    canonicalModel,
    modelIds,
    contextWindowTokens: DEEPSEEK_V4_CONTEXT_WINDOW_TOKENS,
    softThreshold: Math.floor(DEEPSEEK_V4_CONTEXT_WINDOW_TOKENS * DEEPSEEK_V4_SOFT_THRESHOLD_RATIO),
    hardThreshold: Math.floor(DEEPSEEK_V4_CONTEXT_WINDOW_TOKENS * DEEPSEEK_V4_HARD_THRESHOLD_RATIO),
    inputModalities: DEFAULT_MODEL_INPUT_MODALITIES,
    outputModalities: DEFAULT_MODEL_OUTPUT_MODALITIES,
    supportsToolCalling: true,
    messageParts: DEFAULT_MODEL_MESSAGE_PARTS,
    reasoning: {
      supportedEfforts: ['off', 'high', 'max'],
      defaultEffort: 'max',
      requestProtocol: 'deepseek-chat-completions'
    }
  }
}

function glmReasoningProfile(
  canonicalModel: string,
  contextWindowTokens: number
): ModelContextProfile {
  return {
    canonicalModel,
    modelIds: [canonicalModel],
    contextWindowTokens,
    softThreshold: Math.floor(contextWindowTokens * DEEPSEEK_V4_SOFT_THRESHOLD_RATIO),
    hardThreshold: Math.floor(contextWindowTokens * DEEPSEEK_V4_HARD_THRESHOLD_RATIO),
    inputModalities: DEFAULT_MODEL_INPUT_MODALITIES,
    outputModalities: DEFAULT_MODEL_OUTPUT_MODALITIES,
    supportsToolCalling: true,
    messageParts: DEFAULT_MODEL_MESSAGE_PARTS,
    reasoning: copyReasoningCapability(GLM_REASONING)
  }
}

function codexReasoningProfile(
  canonicalModel: string,
  contextWindowTokens: number,
  responsesLite = false,
  imageInput = true
): ModelContextProfile {
  return {
    canonicalModel,
    modelIds: [canonicalModel],
    contextWindowTokens,
    softThreshold: Math.floor(contextWindowTokens * DEEPSEEK_V4_SOFT_THRESHOLD_RATIO),
    hardThreshold: Math.floor(contextWindowTokens * DEEPSEEK_V4_HARD_THRESHOLD_RATIO),
    inputModalities: imageInput ? ['text', 'image'] : DEFAULT_MODEL_INPUT_MODALITIES,
    outputModalities: DEFAULT_MODEL_OUTPUT_MODALITIES,
    supportsToolCalling: true,
    messageParts: imageInput ? ['text', 'image_url'] : DEFAULT_MODEL_MESSAGE_PARTS,
    reasoning: copyReasoningCapability(CODEX_RESPONSES_REASONING),
    ...(responsesLite ? { responsesMode: 'lite' as const } : {})
  }
}

function mergeModelContextProfile(
  canonicalModel: string,
  current: ModelContextProfile | undefined,
  input: ModelContextProfileConfig
): ModelContextProfile {
  const compaction = input.contextCompaction ?? {}
  const configuredContextWindowTokens = input.contextWindowTokens ?? current?.contextWindowTokens
  const softThreshold = compaction.softThreshold ?? input.softThreshold ?? thresholdFromWindow({
    contextWindowTokens: configuredContextWindowTokens,
    ratio: compaction.softRatio ?? input.softRatio,
    fallbackRatio: current
      ? current.softThreshold / current.contextWindowTokens
      : DEEPSEEK_V4_SOFT_THRESHOLD_RATIO,
    fallbackThreshold: current?.softThreshold
  })
  const hardThreshold = compaction.hardThreshold ?? input.hardThreshold ?? thresholdFromWindow({
    contextWindowTokens: configuredContextWindowTokens,
    ratio: compaction.hardRatio ?? input.hardRatio,
    fallbackRatio: current
      ? current.hardThreshold / current.contextWindowTokens
      : DEEPSEEK_V4_HARD_THRESHOLD_RATIO,
    fallbackThreshold: current?.hardThreshold
  })
  const contextWindowTokens =
    configuredContextWindowTokens ?? Math.max(softThreshold ?? 0, hardThreshold ?? 0)
  if (!contextWindowTokens || !softThreshold || !hardThreshold) {
    throw new Error(`model context profile "${canonicalModel}" needs a context window or thresholds`)
  }
  if (hardThreshold < softThreshold) {
    throw new Error(`model context profile "${canonicalModel}" hard threshold must be >= soft threshold`)
  }
  const modelIds = uniqueModelIds([
    canonicalModel,
    ...(current?.modelIds ?? []),
    ...(input.aliases ?? [])
  ])
  const reasoning = input.reasoning ?? current?.reasoning
  const serviceTiers = input.serviceTiers ?? current?.serviceTiers
  const endpointFormat = input.endpointFormat ?? current?.endpointFormat
  const responsesMode = input.responsesMode ?? current?.responsesMode
  const maxOutputTokens = input.maxOutputTokens ?? current?.maxOutputTokens
  return {
    canonicalModel,
    modelIds,
    contextWindowTokens,
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    softThreshold,
    hardThreshold,
    inputModalities: uniqueModelCapabilityValues(input.inputModalities ?? current?.inputModalities ?? DEFAULT_MODEL_INPUT_MODALITIES),
    outputModalities: uniqueModelCapabilityValues(input.outputModalities ?? current?.outputModalities ?? DEFAULT_MODEL_OUTPUT_MODALITIES),
    supportsToolCalling: input.supportsToolCalling ?? current?.supportsToolCalling ?? true,
    messageParts: uniqueModelCapabilityValues(input.messageParts ?? current?.messageParts ?? DEFAULT_MODEL_MESSAGE_PARTS),
    ...(reasoning
      ? { reasoning: copyReasoningCapability(reasoning) }
      : {}),
    ...(serviceTiers ? { serviceTiers: [...serviceTiers] } : {}),
    ...(endpointFormat ? { endpointFormat } : {}),
    ...(responsesMode ? { responsesMode } : {})
  }
}

function copyReasoningCapability(
  reasoning: ModelReasoningCapabilityMetadata
): ModelReasoningCapabilityMetadata {
  return {
    supportedEfforts: [...reasoning.supportedEfforts],
    defaultEffort: reasoning.defaultEffort,
    requestProtocol: reasoning.requestProtocol
  }
}

function thresholdFromWindow(input: {
  contextWindowTokens: number | undefined
  ratio: number | undefined
  fallbackRatio: number
  fallbackThreshold: number | undefined
}): number | undefined {
  if (!input.contextWindowTokens) return input.fallbackThreshold
  return Math.floor(input.contextWindowTokens * (input.ratio ?? input.fallbackRatio))
}

function modelProfileGroupsFromConfig(
  config: ContextCompactionConfig | ModelConfig | ModelProfileConfigSource | undefined
): Array<Record<string, ModelContextProfileConfig>> {
  if (!config) return []
  if ('models' in config || 'contextCompaction' in config) {
    return [
      ...(config.contextCompaction?.modelProfiles ? [config.contextCompaction.modelProfiles] : []),
      ...(config.models?.profiles ? [config.models.profiles] : [])
    ]
  }
  if ('profiles' in config) {
    return config.profiles ? [config.profiles] : []
  }
  if ('modelProfiles' in config) {
    return config.modelProfiles ? [config.modelProfiles] : []
  }
  return []
}

function uniqueModelIds(values: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = normalizeModelId(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function uniqueModelCapabilityValues<T extends string>(values: readonly T[]): T[] {
  const out: T[] = []
  const seen = new Set<T>()
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function normalizeModelId(model: string | undefined): string {
  const normalized = model?.trim().toLowerCase() ?? ''
  return normalized === 'auto' ? '' : normalized
}

function isKimiK3Model(model: string, provider: string): boolean {
  const basename = model.split('/').at(-1) ?? model
  if (
    basename === 'k3' ||
    basename.startsWith('k3-') ||
    basename === 'kimi-k3' ||
    basename.startsWith('kimi-k3-')
  ) {
    return true
  }
  if (!(provider.includes('kimi-code') || provider.includes('moonshot'))) return false
  return basename === 'k3' || basename.startsWith('k3-') || basename.includes('kimi-k3')
}
