import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_IMAGE_GENERATION_PROTOCOL,
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  DEFAULT_MODEL_PROVIDER_ID,
  DEFAULT_MODEL_REQUEST_RETRY_HTTP_STATUS_CODES,
  DEFAULT_MODEL_REQUEST_RETRY_INITIAL_DELAY_MS,
  DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS,
  NETWORK_PROXY_PROTOCOLS,
  DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
  DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  DEFAULT_VIDEO_GENERATION_PROTOCOL,
  MODEL_REASONING_EFFORTS,
  MODEL_REASONING_REQUEST_PROTOCOLS,
  MODEL_ROUTE_STRATEGIES,
  CUSTOM_IMAGE_GENERATION_PROVIDER_ID,
  CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID,
  CUSTOM_TEXT_TO_SPEECH_PROVIDER_ID,
  CUSTOM_MUSIC_GENERATION_PROVIDER_ID,
  CUSTOM_VIDEO_GENERATION_PROVIDER_ID,
  type AppSettingsV1,
  type ImageGenerationProtocol,
  type KunImageGenerationSettingsV1,
  type KunMusicGenerationSettingsV1,
  type KunRuntimeSettingsV1,
  type KunRuntimeSettingsPatchV1,
  type KunSpeechToTextSettingsV1,
  type KunTextToSpeechSettingsV1,
  type KunVideoGenerationSettingsV1,
  type MusicGenerationProtocol,
  type ModelProviderImageCapabilityPatchV1,
  type ModelProviderImageCapabilityV1,
  type ModelProviderInputModality,
  type ModelProviderMessagePartSupport,
  type ModelProviderModelProfilePatchV1,
  type ModelProviderModelProfileV1,
  type ModelProviderModelPricingV1,
  type ModelProviderMusicCapabilityPatchV1,
  type ModelProviderMusicCapabilityV1,
  type ModelProviderReasoningCapabilityV1,
  type ModelProviderProfilePatchV1,
  type ModelProviderProfileV1,
  type ModelProviderPresetSourceV1,
  type ModelRequestRetrySettingsV1,
  type ModelRouteFailurePolicyV1,
  type ModelRouteHealthPolicyV1,
  type ModelRoutePoolV1,
  type ModelRouteTargetResolutionV1,
  type ModelRouteTargetV1,
  type ModelRouteStrategy,
  type ModelProviderSettingsPatchV1,
  type ModelProviderSettingsV1,
  type NetworkProxySettingsV1,
  type ModelProviderSpeechCapabilityPatchV1,
  type ModelProviderSpeechCapabilityV1,
  type ModelProviderTextToSpeechCapabilityPatchV1,
  type ModelProviderTextToSpeechCapabilityV1,
  type ModelProviderVideoCapabilityPatchV1,
  type ModelProviderVideoCapabilityV1,
  type SpeechToTextProtocol,
  type TextToSpeechProtocol,
  type VideoGenerationProtocol
} from './app-settings-types'
import { normalizeModelEndpointFormat, type ModelEndpointFormat } from '../../kun/src/contracts/model-endpoint-format.js'
import {
  MAX_MODEL_CONTEXT_WINDOW_TOKENS,
  MAX_MODEL_OUTPUT_TOKENS
} from '../../kun/src/contracts/capabilities.js'
import { getKunRuntimeSettings } from './app-settings-kun'
import { normalizeDeepseekBaseUrl } from './app-settings-normalizers'
import { DEFAULT_COMPOSER_MODEL_IDS } from './default-composer-models'
import {
  CHATGPT_SUBSCRIPTION_LEGACY_MODEL_IDS,
  CHATGPT_SUBSCRIPTION_LEGACY_NAME,
  CHATGPT_SUBSCRIPTION_MODEL_IDS,
  CHATGPT_SUBSCRIPTION_NAME,
  CHATGPT_SUBSCRIPTION_PROVIDER_ID,
  GEMINI_SUBSCRIPTION_MODEL_IDS,
  TOKEN_PLAN_PROVIDER_ID_SUFFIX,
  getModelProviderPreset,
  modelProviderPresetProfile,
  modelProviderTokenPlanProfile,
  resolveModelProviderPresetSource,
  type ModelProviderPreset
} from './model-provider-presets'

export function presetModelProfilesForProvider(
  provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>
): Record<string, ModelProviderModelProfileV1> | null {
  const source = resolveModelProviderPresetSource(provider)
  if (!source) return null
  const profiles = source.mode === 'token-plan'
    ? source.preset.tokenPlan?.modelProfiles ?? source.preset.modelProfiles
    : source.preset.modelProfiles
  return profiles ?? null
}

export function normalizeModelProviderModelProfiles(
  input: Record<string, ModelProviderModelProfilePatchV1 | null> | undefined,
  models: readonly string[]
): Record<string, ModelProviderModelProfileV1> {
  const profiles: Record<string, ModelProviderModelProfileV1> = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return profiles
  const knownModelKeys = new Set(models.map(normalizeModelKey).filter(Boolean))
  for (const [rawModelId, rawProfile] of Object.entries(input)) {
    const modelId = normalizeModelKey(rawModelId)
    if (!modelId || rawProfile === null) continue
    if (knownModelKeys.size > 0 && !knownModelKeys.has(modelId)) {
      const aliases = normalizeProviderModels(rawProfile.aliases)
      if (!aliases.some((alias) => knownModelKeys.has(normalizeModelKey(alias)))) continue
    }
    profiles[modelId] = normalizeModelProviderModelProfile(rawProfile)
  }
  return profiles
}

export function normalizeModelProviderModelProfile(
  input: ModelProviderModelProfilePatchV1 | undefined
): ModelProviderModelProfileV1 {
  const inputModalities = normalizeModelInputModalities(input?.inputModalities)
  const defaultMessageParts: ModelProviderMessagePartSupport[] = inputModalities.includes('image')
    ? ['text', 'image_url']
    : ['text']
  const contextWindowTokens = boundedPositiveInteger(
    input?.contextWindowTokens,
    MAX_MODEL_CONTEXT_WINDOW_TOKENS
  )
  const maxOutputTokens = boundedPositiveInteger(
    input?.maxOutputTokens,
    MAX_MODEL_OUTPUT_TOKENS
  )
  const reasoning = normalizeModelReasoningCapability(input?.reasoning)
  const pricing = normalizeModelProviderPricing(input?.pricing)
  const serviceTiers = normalizeModelServiceTiers(input?.serviceTiers)
  const endpointFormat = normalizeOptionalModelEndpointFormat(input?.endpointFormat)
  const responsesMode = input?.responsesMode === 'lite' ? 'lite' : undefined
  return {
    ...(normalizeProviderModels(input?.aliases).length
      ? { aliases: normalizeProviderModels(input?.aliases) }
      : {}),
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    inputModalities,
    outputModalities: normalizeModelInputModalities(input?.outputModalities),
    supportsToolCalling: input?.supportsToolCalling !== false,
    messageParts: normalizeModelMessageParts(input?.messageParts, defaultMessageParts),
    ...(reasoning ? { reasoning } : {}),
    ...(pricing ? { pricing } : {}),
    ...(serviceTiers.length ? { serviceTiers } : {}),
    ...(endpointFormat ? { endpointFormat } : {}),
    ...(responsesMode ? { responsesMode } : {})
  }
}

/**
 * Catalog reference pricing is only meaningful when both input and output
 * prices are finite non-negative numbers; cache prices stay optional. Invalid
 * entries are dropped entirely rather than partially kept.
 */
export function normalizeModelProviderPricing(
  input: ModelProviderModelProfileV1['pricing'] | undefined
): ModelProviderModelPricingV1 | undefined {
  const inputValue = nonNegativeFinitePrice(input?.inputUsdPerMillion)
  const outputValue = nonNegativeFinitePrice(input?.outputUsdPerMillion)
  if (inputValue == null || outputValue == null) return undefined
  const cacheRead = nonNegativeFinitePrice(input?.cacheReadUsdPerMillion)
  const cacheWrite = nonNegativeFinitePrice(input?.cacheWriteUsdPerMillion)
  return {
    inputUsdPerMillion: inputValue,
    outputUsdPerMillion: outputValue,
    ...(cacheRead != null ? { cacheReadUsdPerMillion: cacheRead } : {}),
    ...(cacheWrite != null ? { cacheWriteUsdPerMillion: cacheWrite } : {})
  }
}

function nonNegativeFinitePrice(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function normalizeModelServiceTiers(
  value: unknown
): NonNullable<ModelProviderModelProfileV1['serviceTiers']> {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(
    (tier): tier is NonNullable<ModelProviderModelProfileV1['serviceTiers']>[number] =>
      tier === 'priority' || tier === 'flex'
  ))]
}

/**
 * A per-model wire-format override is only meaningful when explicitly set;
 * an absent value means "inherit the provider's endpointFormat". Returns
 * undefined for blank/missing input instead of coercing to the default, so
 * inheritance is preserved end-to-end.
 */
export function normalizeOptionalModelEndpointFormat(
  value: unknown
): ModelEndpointFormat | undefined {
  return typeof value === 'string' && value.trim()
    ? normalizeModelEndpointFormat(value)
    : undefined
}

export function normalizeModelReasoningCapability(
  input: ModelProviderModelProfilePatchV1['reasoning'] | undefined
): ModelProviderReasoningCapabilityV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const supportedEfforts = normalizeReasoningEfforts(input.supportedEfforts)
  if (supportedEfforts.length === 0) return undefined
  const defaultEffort = normalizeReasoningEffort(input.defaultEffort)
  const resolvedDefault = defaultEffort && supportedEfforts.includes(defaultEffort)
    ? defaultEffort
    : supportedEfforts[0]
  const requestProtocol = normalizeReasoningRequestProtocol(input.requestProtocol)
  if (!requestProtocol) return undefined
  return {
    supportedEfforts,
    defaultEffort: resolvedDefault,
    requestProtocol
  }
}

export function normalizeReasoningEfforts(value: unknown): ModelProviderReasoningCapabilityV1['supportedEfforts'] {
  if (!Array.isArray(value)) return []
  const out: ModelProviderReasoningCapabilityV1['supportedEfforts'] = []
  for (const item of value) {
    const effort = normalizeReasoningEffort(item)
    if (effort && !out.includes(effort)) out.push(effort)
  }
  return out
}

export function normalizeReasoningEffort(value: unknown): ModelProviderReasoningCapabilityV1['defaultEffort'] | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return MODEL_REASONING_EFFORTS.includes(normalized as ModelProviderReasoningCapabilityV1['defaultEffort'])
    ? normalized as ModelProviderReasoningCapabilityV1['defaultEffort']
    : undefined
}

export function normalizeReasoningRequestProtocol(
  value: unknown
): ModelProviderReasoningCapabilityV1['requestProtocol'] | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return MODEL_REASONING_REQUEST_PROTOCOLS.includes(normalized as ModelProviderReasoningCapabilityV1['requestProtocol'])
    ? normalized as ModelProviderReasoningCapabilityV1['requestProtocol']
    : undefined
}

export function normalizeModelInputModalities(value: unknown): ModelProviderInputModality[] {
  if (!Array.isArray(value)) return ['text']
  const out: ModelProviderInputModality[] = []
  for (const item of value) {
    if ((item === 'text' || item === 'image') && !out.includes(item)) out.push(item)
  }
  return out.length > 0 ? out : ['text']
}

export function normalizeModelMessageParts(
  value: unknown,
  fallback: ModelProviderMessagePartSupport[]
): ModelProviderMessagePartSupport[] {
  if (!Array.isArray(value)) return [...fallback]
  const out: ModelProviderMessagePartSupport[] = []
  for (const item of value) {
    if (
      (item === 'text' || item === 'image_url' || item === 'input_image') &&
      !out.includes(item)
    ) {
      out.push(item)
    }
  }
  return out.length > 0 ? out : [...fallback]
}

export function boundedPositiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= maximum
    ? value
    : undefined
}

export function normalizeModelProviderImageCapability(
  input: ModelProviderImageCapabilityPatchV1 | null | undefined
): ModelProviderImageCapabilityV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const baseUrl = typeof input.baseUrl === 'string' && input.baseUrl.trim()
    ? normalizeDeepseekBaseUrl(input.baseUrl)
    : ''
  const models = normalizeProviderModels(input.models)
  if (!baseUrl && models.length === 0) return undefined
  return {
    protocol: normalizeImageGenerationProtocol(input.protocol),
    baseUrl,
    models
  }
}

export function normalizeImageGenerationProtocol(value: unknown): ImageGenerationProtocol {
  if (value === 'minimax-image') return 'minimax-image'
  if (value === 'codex-responses-image') return 'codex-responses-image'
  if (value === 'grok-imagine-image') return 'grok-imagine-image'
  if (value === 'volcengine-ark-image') return 'volcengine-ark-image'
  return DEFAULT_IMAGE_GENERATION_PROTOCOL
}

export function normalizeModelProviderSpeechCapability(
  input: ModelProviderSpeechCapabilityPatchV1 | null | undefined
): ModelProviderSpeechCapabilityV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const baseUrl = typeof input.baseUrl === 'string' && input.baseUrl.trim()
    ? normalizeDeepseekBaseUrl(input.baseUrl)
    : ''
  const models = normalizeProviderModels(input.models)
  if (!baseUrl && models.length === 0) return undefined
  return {
    protocol: normalizeSpeechToTextProtocol(input.protocol),
    baseUrl,
    models
  }
}

export function normalizeSpeechToTextProtocol(value: unknown): SpeechToTextProtocol {
  if (value === 'local-whisper') return 'local-whisper'
  if (value === 'mimo-asr') return 'mimo-asr'
  if (value === 'xai-stt') return 'xai-stt'
  if (value === 'gemini-audio') return 'gemini-audio'
  if (value === 'gemini-cli-audio') return 'gemini-cli-audio'
  return DEFAULT_SPEECH_TO_TEXT_PROTOCOL
}

export function normalizeModelProviderTextToSpeechCapability(
  input: ModelProviderTextToSpeechCapabilityPatchV1 | null | undefined
): ModelProviderTextToSpeechCapabilityV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const baseUrl = typeof input.baseUrl === 'string' && input.baseUrl.trim()
    ? normalizeDeepseekBaseUrl(input.baseUrl)
    : ''
  const models = normalizeProviderModels(input.models)
  if (!baseUrl && models.length === 0) return undefined
  return {
    protocol: normalizeTextToSpeechProtocol(input.protocol),
    baseUrl,
    models
  }
}

export function normalizeTextToSpeechProtocol(value: unknown): TextToSpeechProtocol {
  return value === 'minimax-t2a' || value === 'mimo-tts'
    ? value
    : DEFAULT_TEXT_TO_SPEECH_PROTOCOL
}

export function normalizeModelProviderMusicCapability(
  input: ModelProviderMusicCapabilityPatchV1 | null | undefined
): ModelProviderMusicCapabilityV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const baseUrl = typeof input.baseUrl === 'string' && input.baseUrl.trim()
    ? normalizeDeepseekBaseUrl(input.baseUrl)
    : ''
  const models = normalizeProviderModels(input.models)
  if (!baseUrl && models.length === 0) return undefined
  return {
    protocol: normalizeMusicGenerationProtocol(input.protocol),
    baseUrl,
    models
  }
}

export function normalizeMusicGenerationProtocol(value: unknown): MusicGenerationProtocol {
  return value === 'minimax-music' ? 'minimax-music' : DEFAULT_MUSIC_GENERATION_PROTOCOL
}

export function normalizeModelProviderVideoCapability(
  input: ModelProviderVideoCapabilityPatchV1 | null | undefined
): ModelProviderVideoCapabilityV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const baseUrl = typeof input.baseUrl === 'string' && input.baseUrl.trim()
    ? normalizeDeepseekBaseUrl(input.baseUrl)
    : ''
  const models = normalizeProviderModels(input.models)
  if (!baseUrl && models.length === 0) return undefined
  return {
    protocol: normalizeVideoGenerationProtocol(input.protocol),
    baseUrl,
    models
  }
}

export function normalizeVideoGenerationProtocol(value: unknown): VideoGenerationProtocol {
  if (value === 'grok-imagine-video') return 'grok-imagine-video'
  if (value === 'volcengine-ark-video') return 'volcengine-ark-video'
  return value === 'minimax-video' ? 'minimax-video' : DEFAULT_VIDEO_GENERATION_PROTOCOL
}

export function normalizeModelProviderBaseUrl(value: unknown, fallback = DEFAULT_DEEPSEEK_BASE_URL): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed ? normalizeDeepseekBaseUrl(trimmed) : ''
}

export function normalizeProviderModels(models: unknown): string[] {
  if (!Array.isArray(models)) return []
  const ids = new Set<string>()
  for (const model of models) {
    if (typeof model !== 'string') continue
    const trimmed = model.trim()
    if (trimmed) ids.add(trimmed)
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export function normalizeModelProviderId(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
    : ''
}

export function defaultNetworkProxySettings(): NetworkProxySettingsV1 {
  return {
    enabled: false,
    url: ''
  }
}

const LOCAL_MODEL_PROXY_HOST = '127.0.0.1'
const LOCAL_MODEL_PROXY_PORT = /^\d{1,5}$/

/**
 * Extract the port used by the local HTTP proxy editor. The persisted setting
 * remains a URL so every request path can keep using the existing transport
 * contract, while the UI only exposes the local port users need to enter.
 */
export function localModelProxyPort(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  // Preserve incomplete and out-of-range local ports in the editor. They are
  // rejected by `isLocalModelProxyPort` before any request is sent, but must
  // remain visible so the user can correct them.
  const localPortInput = /^(?:https?|socks4a?|socks5h?):\/\/(?:127\.0\.0\.1|localhost|\[::1\]):([^/?#]*)(?:\/)?$/i.exec(raw)
  if (localPortInput) return localPortInput[1] ?? ''
  try {
    const parsed = new URL(raw)
    if (
      !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) ||
      parsed.username || parsed.password || parsed.search || parsed.hash ||
      (parsed.pathname && parsed.pathname !== '/')
    ) {
      return ''
    }
    // URL intentionally elides the default HTTP(S) port (80/443), so retain
    // an explicitly entered port from the raw setting when that happens.
    return parsed.port || /:(\d+)\/?$/.exec(raw)?.[1] || ''
  } catch {
    return ''
  }
}

export function isLocalModelProxyPort(value: unknown): boolean {
  const port = typeof value === 'string' ? value.trim() : ''
  return LOCAL_MODEL_PROXY_PORT.test(port) && Number(port) >= 1 && Number(port) <= 65_535
}

/** Build the proxy URL consumed by model discovery and the Kun runtime. */
export function localModelProxyUrl(port: unknown): string {
  const value = typeof port === 'string' ? port.trim() : ''
  return value ? `http://${LOCAL_MODEL_PROXY_HOST}:${value}` : ''
}

export function normalizeNetworkProxySettings(
  input: Partial<NetworkProxySettingsV1> | undefined
): NetworkProxySettingsV1 {
  // Keep the user's raw (only-trimmed) URL and the enable toggle exactly as
  // given. This normalizer runs on every keystroke (renderer `mergeSettings`),
  // so it must NOT validate/blank the URL here — doing so wiped each
  // half-typed value and made the proxy impossible to set (issue #600).
  // Validity is enforced lazily in `resolveModelProviderProxyUrl`.
  return {
    enabled: input?.enabled === true,
    url: typeof input?.url === 'string' ? input.url.trim() : ''
  }
}

export function normalizeProxyUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    const protocol = parsed.protocol.replace(/:$/, '').toLowerCase()
    if (!NETWORK_PROXY_PROTOCOLS.includes(protocol as typeof NETWORK_PROXY_PROTOCOLS[number])) return ''
    // A hostname is required; the port is optional (the proxy agent falls back
    // to the protocol's default port) so URLs like `http://proxy.lan` work.
    if (!parsed.hostname) return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

export function normalizeModelKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}
