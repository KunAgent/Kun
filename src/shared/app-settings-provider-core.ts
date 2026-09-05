import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_IMAGE_GENERATION_PROTOCOL,
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  DEFAULT_MODEL_PROVIDER_ID,
  DEFAULT_MODEL_REQUEST_RETRY_HTTP_STATUS_CODES,
  DEFAULT_MODEL_REQUEST_RETRY_INITIAL_DELAY_MS,
  DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS,
  PROVIDER_PROXY_ROUTING_VERSION,
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
  OPENCODE_FREE_PROVIDER_ID,
  TOKEN_PLAN_PROVIDER_ID_SUFFIX,
  getModelProviderPreset,
  modelProviderPresetProfile,
  modelProviderTokenPlanProfile,
  resolveModelProviderPresetSource,
  type ModelProviderPreset
} from './model-provider-presets'

import {
  defaultNetworkProxySettings,
  normalizeModelKey,
  normalizeModelProviderBaseUrl,
  normalizeModelProviderId,
  normalizeNetworkProxySettings,
  normalizeProxyUrl
} from './app-settings-provider-capabilities'
import {
  boundedNonNegativeInteger,
  defaultModelProviderProfile,
  normalizeModelProviderProfile,
  normalizeRetryHttpStatusCodes
} from './app-settings-provider-profiles'
import {
  resolveKunRuntimeSettings
} from './app-settings-provider-runtime'

export const DEFAULT_MODEL_PROVIDER_NAME = 'DeepSeek'

export const DEFAULT_PROVIDER_CONTEXT_WINDOW_TOKENS = 256_000

export const DEFAULT_TEXT_MODEL_PROFILE: ModelProviderModelProfileV1 = {
  inputModalities: ['text'],
  outputModalities: ['text'],
  supportsToolCalling: true,
  messageParts: ['text']
}

export const SPEECH_TO_TEXT_MODEL_PATTERN =
  /(^|[/_.:-])(asr|stt|whisper|transcription|transcriptions)([/_.:-]|$)|speech[-_.:/]?to[-_.:/]?text|audio[-_.:/]?transcription/i

export const TEXT_TO_SPEECH_MODEL_PATTERN =
  /(^|[/_.:-])tts([/_.:-]|$)|(^|[/_.:-])speech[-_.:/]?\d|text[-_.:/]?to[-_.:/]?speech|speech[-_.:/]?synthesis|voiceclone|voicedesign/i

export const SPEECH_ONLY_MODEL_PATTERN =
  /(^|[/_.:-])(asr|stt|tts|whisper|transcription|transcriptions|speech)([/_.:-]|$)|voiceclone|voicedesign/i

export const IMAGE_GENERATION_MODEL_PATTERN =
  /(^|[/_.:-])(image|images|dall-e|dalle|flux|sdxl|cogview|wanx|kolors|imagen|seedream|seededit|t2i|i2i)([/_.:-]|$)|stable[-_.:/]?diffusion|text[-_.:/]?to[-_.:/]?image/i

export const MUSIC_GENERATION_MODEL_PATTERN =
  /(^|[/_.:-])(music|song|cover)([/_.:-]|$)|text[-_.:/]?to[-_.:/]?music|music[-_.:/]?generation/i

export const VIDEO_GENERATION_MODEL_PATTERN =
  /(^|[/_.:-])(video|videos|hailuo|sora|veo|kling|seedance|t2v|i2v|s2v)([/_.:-]|$)|text[-_.:/]?to[-_.:/]?video|image[-_.:/]?to[-_.:/]?video/i

export const NON_TEXT_MODEL_PATTERN =
  /(^|[/_.:-])(embedding|embeddings|embed|bge|rerank|reranker|moderation|ocr|image|images|video|videos|music|song|audio|dall-e|dalle|flux|sdxl|cogview|cogvideo|wanx|kolors|imagen|seedream|seededit|seedance|sora|veo|kling|hailuo|t2i|i2i|t2v|i2v|s2v)([/_.:-]|$)|stable[-_.:/]?diffusion|text[-_.:/]?to[-_.:/]?image|text[-_.:/]?to[-_.:/]?video|image[-_.:/]?to[-_.:/]?video|text[-_.:/]?to[-_.:/]?music|music[-_.:/]?generation/i

export function defaultModelProviderSettings(): ModelProviderSettingsV1 {
  const defaultProvider = defaultModelProviderProfile('', DEFAULT_DEEPSEEK_BASE_URL)
  const openCodeFreeProvider = modelProviderPresetProfile(
    getModelProviderPreset(OPENCODE_FREE_PROVIDER_ID)!
  )
  return {
    apiKey: defaultProvider.apiKey,
    baseUrl: defaultProvider.baseUrl,
    proxy: defaultNetworkProxySettings(),
    proxyRoutingVersion: PROVIDER_PROXY_ROUTING_VERSION,
    providers: [defaultProvider, openCodeFreeProvider],
    routePools: [],
    localGateway: { enabled: false, name: 'Kun API' }
  }
}

export function normalizeModelProviderSettings(
  input: ModelProviderSettingsPatchV1 | undefined
): ModelProviderSettingsV1 {
  const defaults = defaultModelProviderSettings()
  const apiKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey
  const baseUrl = normalizeModelProviderBaseUrl(input?.baseUrl, defaults.baseUrl)
  const proxy = normalizeNetworkProxySettings(input?.proxy)
  const legacyProxyRouting = input?.proxyRoutingVersion !== PROVIDER_PROXY_ROUTING_VERSION
  const missingUseProxy = legacyProxyRouting && proxy.enabled
  const rawProviders = Array.isArray(input?.providers) ? input.providers : []
  const providersById = new Map<string, ModelProviderProfileV1>()
  const defaultProvider = {
    ...defaultModelProviderProfile(apiKey, baseUrl),
    useProxy: missingUseProxy
  }
  const openCodeFreeProvider = modelProviderPresetProfile(
    getModelProviderPreset(OPENCODE_FREE_PROVIDER_ID)!
  )
  openCodeFreeProvider.useProxy = missingUseProxy
  providersById.set(defaultProvider.id, defaultProvider)
  providersById.set(openCodeFreeProvider.id, openCodeFreeProvider)
  for (const rawProvider of rawProviders) {
    const provider = normalizeModelProviderProfile(rawProvider, missingUseProxy)
    if (!provider) continue
    providersById.set(provider.id, provider.id === DEFAULT_MODEL_PROVIDER_ID
      ? {
          ...defaultProvider,
          ...provider,
          apiKey,
          baseUrl,
          modelProfiles: {
            ...defaultProvider.modelProfiles,
            ...provider.modelProfiles
          }
        }
      : provider)
  }
  const providers = [...providersById.values()]
  const routePools = normalizeModelRoutePools(input?.routePools, providers)
  return {
    apiKey,
    baseUrl,
    proxy,
    proxyRoutingVersion: PROVIDER_PROXY_ROUTING_VERSION,
    providers,
    routePools,
    localGateway: {
      enabled: input?.localGateway?.enabled === true,
      name: typeof input?.localGateway?.name === 'string' && input.localGateway.name.trim()
        ? input.localGateway.name.trim().slice(0, 80)
        : defaults.localGateway.name
    }
  }
}

export function mergeModelProviderSettings(
  current: ModelProviderSettingsV1,
  patch: ModelProviderSettingsPatchV1 | undefined
): ModelProviderSettingsV1 {
  return normalizeModelProviderSettings({
    ...current,
    ...(patch ?? {}),
    proxy: patch?.proxy
      ? {
          ...current.proxy,
          ...patch.proxy
        }
      : current.proxy,
    routePools: patch?.routePools ?? current.routePools,
    localGateway: patch?.localGateway
      ? { ...current.localGateway, ...patch.localGateway }
      : current.localGateway
  })
}

export const DEFAULT_MODEL_ROUTE_FAILURE_POLICY: ModelRouteFailurePolicyV1 = {
  failoverHttpStatusCodes: [401, 402, 403, 404, 408, 425, 429, 500, 502, 503, 504],
  failoverOnNetworkError: true,
  failoverOnTimeout: true,
  failoverOnAuthError: true
}

export const DEFAULT_MODEL_ROUTE_HEALTH_POLICY: ModelRouteHealthPolicyV1 = {
  failureThreshold: 3,
  cooldownMs: 60_000,
  halfOpenMaxAttempts: 1
}

export function normalizeModelRoutePools(
  input: readonly Partial<ModelRoutePoolV1>[] | undefined,
  _providers?: readonly ModelProviderProfileV1[]
): ModelRoutePoolV1[] {
  const usedIds = new Set<string>()
  const usedModels = new Set<string>()
  const out: ModelRoutePoolV1[] = []
  for (const raw of Array.isArray(input) ? input.slice(0, 100) : []) {
    const id = normalizeModelProviderId(raw.id)
    const modelId = typeof raw.modelId === 'string' ? raw.modelId.trim().slice(0, 512) : ''
    if (!id || !modelId || usedIds.has(id) || usedModels.has(modelId.toLowerCase())) continue
    const targetIds = new Set<string>()
    const targets = (Array.isArray(raw.targets) ? raw.targets : []).slice(0, 50).flatMap((target: ModelRoutePoolV1['targets'][number], index: number) => {
      const providerId = normalizeModelProviderId(target?.providerId)
      const targetModel = typeof target?.modelId === 'string' ? target.modelId.trim().slice(0, 512) : ''
      if (!providerId || !targetModel) return []
      const targetId = normalizeModelProviderId(target?.id) || `${id}-target-${index + 1}`
      if (targetIds.has(targetId)) return []
      targetIds.add(targetId)
      return [{
        id: targetId,
        providerId,
        modelId: targetModel,
        enabled: target?.enabled !== false,
        weight: Math.min(100, Math.max(1, boundedNonNegativeInteger(target?.weight, 1, 100)))
      }]
    })
    const strategy: ModelRouteStrategy = MODEL_ROUTE_STRATEGIES.includes(raw.strategy as ModelRouteStrategy)
      ? raw.strategy as ModelRouteStrategy
      : 'priority'
    const failureCodes = normalizeRetryHttpStatusCodes(
      raw.failurePolicy?.failoverHttpStatusCodes,
      DEFAULT_MODEL_ROUTE_FAILURE_POLICY.failoverHttpStatusCodes
    )
    const pool: ModelRoutePoolV1 = {
      id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : modelId,
      modelId,
      // A public route alias may intentionally match a concrete model id
      // (for example, a routed `kimi-k3` backed by several providers). Kun
      // disambiguates the virtual route from a direct provider selection with
      // the request's provider id, so only duplicate route aliases are invalid.
      enabled: raw.enabled !== false,
      strategy,
      targets,
      failurePolicy: {
        failoverHttpStatusCodes: failureCodes,
        failoverOnNetworkError: raw.failurePolicy?.failoverOnNetworkError !== false,
        failoverOnTimeout: raw.failurePolicy?.failoverOnTimeout !== false,
        failoverOnAuthError: raw.failurePolicy?.failoverOnAuthError !== false
      },
      healthPolicy: {
        failureThreshold: Math.min(20, Math.max(1, boundedNonNegativeInteger(raw.healthPolicy?.failureThreshold, 3, 20))),
        cooldownMs: Math.min(3_600_000, Math.max(1_000, boundedNonNegativeInteger(raw.healthPolicy?.cooldownMs, 60_000, 3_600_000))),
        halfOpenMaxAttempts: Math.min(10, Math.max(1, boundedNonNegativeInteger(raw.healthPolicy?.halfOpenMaxAttempts, 1, 10)))
      }
    }
    usedIds.add(id)
    usedModels.add(modelId.toLowerCase())
    out.push(pool)
  }
  return out
}

export function resolveModelRouteTargetReference(
  target: Pick<ModelRouteTargetV1, 'providerId' | 'modelId'>,
  providers: readonly ModelProviderProfileV1[]
): ModelRouteTargetResolutionV1 {
  const providerId = normalizeModelProviderId(target.providerId)
  const provider = providers.find((candidate) => candidate.id.toLowerCase() === providerId)
  if (!provider) return { status: 'provider-missing' }
  const requestedModel = target.modelId.trim().toLowerCase()
  const modelId = provider.models.find((candidate) => candidate.trim().toLowerCase() === requestedModel)
  if (!modelId) return { status: 'model-missing', provider }
  return { status: 'valid', provider, modelId }
}

/**
 * Projects durable user intent into the concrete configuration Kun may run.
 * Missing references remain in settings but never reach the Runtime.
 */
export function projectExecutableModelRoutePools(
  settings: Pick<ModelProviderSettingsV1, 'providers' | 'routePools'>
): ModelRoutePoolV1[] {
  return settings.routePools.map((pool) => {
    const targets = pool.targets.flatMap((target) => {
      const resolved = resolveModelRouteTargetReference(target, settings.providers)
      if (resolved.status !== 'valid' || !resolved.provider || !resolved.modelId) return []
      return [{
        ...target,
        providerId: resolved.provider.id,
        modelId: resolved.modelId
      }]
    })
    return {
      ...pool,
      enabled: pool.enabled && targets.some((target) => target.enabled),
      targets
    }
  })
}

export function getModelProviderSettings(settings: AppSettingsV1): ModelProviderSettingsV1 {
  return normalizeModelProviderSettings((settings as { provider?: ModelProviderSettingsPatchV1 }).provider)
}

export function modelProviderSettingsPatch(
  provider: ModelProviderSettingsPatchV1 | undefined
): ModelProviderSettingsPatchV1 {
  return provider ? { ...provider } : {}
}

export function resolveModelProviderApiKey(settings: AppSettingsV1): string {
  return getDefaultModelProviderProfile(settings).apiKey.trim()
}

export function resolveModelProviderBaseUrl(settings: AppSettingsV1): string {
  return normalizeDeepseekBaseUrl(getDefaultModelProviderProfile(settings).baseUrl)
}

export function resolveModelProviderProxyUrl(settings: AppSettingsV1): string {
  const proxy = getModelProviderSettings(settings).proxy
  if (!proxy.enabled) return ''
  // Validation happens here, at the apply boundary — not while the user types
  // (see `normalizeNetworkProxySettings`). An invalid/incomplete URL simply
  // means "no proxy" for outbound requests instead of wiping the saved value.
  return normalizeProxyUrl(proxy.url)
}

export type ProviderProxyRoute =
  | { mode: 'direct'; reason: 'not-selected' | 'master-disabled' | 'unsupported' }
  | { mode: 'proxy'; url: string }
  | { mode: 'invalid'; reason: 'invalid-enabled-proxy' }

export class ProviderProxyConfigurationError extends Error {
  readonly code = 'provider_proxy_invalid'

  constructor(readonly providerId: string) {
    super(`Provider ${providerId} selected the app proxy, but the proxy configuration is invalid.`)
    this.name = 'ProviderProxyConfigurationError'
  }
}

export function modelProviderSupportsAppProxy(
  provider: Pick<ModelProviderProfileV1, 'kind'>
): boolean {
  return provider.kind !== 'agent-sdk' &&
    provider.kind !== 'antigravity-cli' &&
    provider.kind !== 'cursor-sdk'
}

export function resolveProviderProxyRoute(
  settings: AppSettingsV1,
  providerOrId: Pick<ModelProviderProfileV1, 'id' | 'kind' | 'useProxy'> | string
): ProviderProxyRoute {
  const provider = typeof providerOrId === 'string'
    ? getModelProviderSettings(settings).providers.find(
      (candidate) => candidate.id === normalizeModelProviderId(providerOrId)
    ) ?? { id: providerOrId, kind: 'http' as const, useProxy: false }
    : providerOrId
  if (!modelProviderSupportsAppProxy(provider)) return { mode: 'direct', reason: 'unsupported' }
  if (provider.useProxy !== true) return { mode: 'direct', reason: 'not-selected' }
  const proxy = getModelProviderSettings(settings).proxy
  if (!proxy.enabled) return { mode: 'direct', reason: 'master-disabled' }
  const url = normalizeProxyUrl(proxy.url)
  return url ? { mode: 'proxy', url } : { mode: 'invalid', reason: 'invalid-enabled-proxy' }
}

export function resolveProviderProxyUrl(
  settings: AppSettingsV1,
  providerOrId: Pick<ModelProviderProfileV1, 'id' | 'kind' | 'useProxy'> | string
): string {
  const provider = typeof providerOrId === 'string'
    ? getModelProviderSettings(settings).providers.find(
      (candidate) => candidate.id === normalizeModelProviderId(providerOrId)
    ) ?? { id: providerOrId, kind: 'http' as const, useProxy: false }
    : providerOrId
  const route = resolveProviderProxyRoute(settings, provider)
  if (route.mode === 'invalid') throw new ProviderProxyConfigurationError(provider.id)
  return route.mode === 'proxy' ? route.url : ''
}

export function getDefaultModelProviderProfile(settings: AppSettingsV1): ModelProviderProfileV1 {
  return getModelProviderProfile(settings, DEFAULT_MODEL_PROVIDER_ID)
}

export function getModelProviderProfile(
  settings: AppSettingsV1,
  providerId: string | undefined
): ModelProviderProfileV1 {
  const provider = getModelProviderSettings(settings)
  const id = normalizeModelProviderId(providerId || DEFAULT_MODEL_PROVIDER_ID)
  return provider.providers.find((profile) => profile.id === id) ?? provider.providers[0] ?? defaultModelProviderProfile(provider.apiKey, provider.baseUrl)
}

export function modelProviderRequiresApiKey(
  provider: Pick<ModelProviderProfileV1, 'id' | 'kind' | 'presetSource'>
): boolean {
  if (
    provider.kind === 'agent-sdk' ||
    provider.kind === 'antigravity-cli' ||
    provider.kind === 'gemini-cli-api' ||
    provider.kind === 'gemini-code-assist'
  ) {
    return false
  }

  const source = resolveModelProviderPresetSource(provider)
  if (
    provider.id === OPENCODE_FREE_PROVIDER_ID ||
    source?.preset.id === 'litellm' ||
    source?.preset.id === OPENCODE_FREE_PROVIDER_ID
  ) return false
  // Every remaining profile uses API-key authentication. In particular,
  // manually created HTTP providers have no presetSource, which must not make
  // the credential field disappear from Settings (#1245).
  return true
}

export function activeModelProviderNeedsApiKey(settings: AppSettingsV1): boolean {
  const runtime = getKunRuntimeSettings(settings)
  const provider = getModelProviderProfile(settings, runtime.providerId)
  return modelProviderRequiresApiKey(provider) && !resolveKunRuntimeSettings(settings).apiKey.trim()
}

export function listModelProviderModelIds(settings: AppSettingsV1): string[] {
  const ids = new Set<string>()
  const providerSettings = getModelProviderSettings(settings)
  for (const provider of providerSettings.providers) {
    for (const model of provider.models) {
      const trimmed = model.trim()
      if (!trimmed || !isProviderComposerChatModelId(provider, trimmed)) continue
      ids.add(trimmed)
    }
  }
  for (const pool of projectExecutableModelRoutePools(providerSettings)) {
    if (pool.enabled && pool.targets.some((target) => target.enabled)) ids.add(pool.modelId)
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

/**
 * Media model IDs apply only to the provider that declares them. Different
 * providers can expose the same model ID with different capabilities.
 */
export function listProviderNonTextModelIds(
  provider: Pick<ModelProviderProfileV1, 'image' | 'speech' | 'textToSpeech' | 'music' | 'video'>
): string[] {
  return [...new Set([
    ...(provider.speech?.models ?? []),
    ...(provider.image?.models ?? []),
    ...(provider.textToSpeech?.models ?? []),
    ...(provider.music?.models ?? []),
    ...(provider.video?.models ?? [])
  ])]
    .map((model) => model.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
}

export function listSpeechToTextModelIds(settings: AppSettingsV1): string[] {
  const ids = new Set<string>()
  for (const provider of getModelProviderSettings(settings).providers) {
    for (const model of provider.speech?.models ?? []) {
      const trimmed = model.trim()
      if (trimmed) ids.add(trimmed)
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export function listImageGenerationModelIds(settings: AppSettingsV1): string[] {
  const ids = new Set<string>()
  for (const provider of getModelProviderSettings(settings).providers) {
    for (const model of provider.image?.models ?? []) {
      const trimmed = model.trim()
      if (trimmed) ids.add(trimmed)
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export function listTextToSpeechModelIds(settings: AppSettingsV1): string[] {
  const ids = new Set<string>()
  for (const provider of getModelProviderSettings(settings).providers) {
    for (const model of provider.textToSpeech?.models ?? []) {
      const trimmed = model.trim()
      if (trimmed) ids.add(trimmed)
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export function listMusicGenerationModelIds(settings: AppSettingsV1): string[] {
  const ids = new Set<string>()
  for (const provider of getModelProviderSettings(settings).providers) {
    for (const model of provider.music?.models ?? []) {
      const trimmed = model.trim()
      if (trimmed) ids.add(trimmed)
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export function listVideoGenerationModelIds(settings: AppSettingsV1): string[] {
  const ids = new Set<string>()
  for (const provider of getModelProviderSettings(settings).providers) {
    for (const model of provider.video?.models ?? []) {
      const trimmed = model.trim()
      if (trimmed) ids.add(trimmed)
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export function listNonTextModelIds(settings: AppSettingsV1): string[] {
  return [...new Set(
    getModelProviderSettings(settings).providers.flatMap((provider) => listProviderNonTextModelIds(provider))
  )].sort((a, b) => a.localeCompare(b))
}

export function isComposerChatModelId(
  modelId: string,
  nonTextModelIds: readonly string[] = []
): boolean {
  const normalized = modelId.trim().toLowerCase()
  if (!normalized || normalized === 'auto') return false
  const excludedIds = new Set(nonTextModelIds.map((id) => id.trim().toLowerCase()).filter(Boolean))
  if (excludedIds.has(normalized)) return false
  return !SPEECH_ONLY_MODEL_PATTERN.test(normalized) && !NON_TEXT_MODEL_PATTERN.test(normalized)
}

export function isProviderComposerChatModelId(
  provider: ModelProviderProfileV1,
  modelId: string
): boolean {
  const profile = modelProviderModelProfile(provider, modelId)
  if (profile && !modelProfileSupportsTextChat(profile)) return false
  return isComposerChatModelId(
    modelId,
    profile ? [] : listProviderNonTextModelIds(provider)
  )
}

export function isSpeechToTextModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase()
  return Boolean(normalized) && SPEECH_TO_TEXT_MODEL_PATTERN.test(normalized)
}

export function isImageGenerationModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase()
  return Boolean(normalized) && IMAGE_GENERATION_MODEL_PATTERN.test(normalized)
}

export function isTextToSpeechModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase()
  return Boolean(normalized) && TEXT_TO_SPEECH_MODEL_PATTERN.test(normalized)
}

export function isMusicGenerationModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase()
  return Boolean(normalized) && MUSIC_GENERATION_MODEL_PATTERN.test(normalized)
}

export function isVideoGenerationModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase()
  return Boolean(normalized) && VIDEO_GENERATION_MODEL_PATTERN.test(normalized)
}

export function modelProfileSupportsTextChat(
  profile: Pick<ModelProviderModelProfileV1, 'inputModalities' | 'outputModalities'> | undefined
): boolean {
  if (!profile) return true
  return profile.inputModalities.includes('text') && profile.outputModalities.includes('text')
}

export function modelProviderModelProfile(
  provider: Pick<ModelProviderProfileV1, 'modelProfiles'>,
  modelId: string
): ModelProviderModelProfileV1 | undefined {
  const normalized = normalizeModelKey(modelId)
  if (!normalized) return undefined
  return provider.modelProfiles[normalized]
}

export function modelProviderModelProfilesForProvider(
  settings: AppSettingsV1,
  providerId: string
): Record<string, ModelProviderModelProfileV1> {
  const profiles: Record<string, ModelProviderModelProfileV1> = {}
  const provider = getModelProviderProfile(settings, providerId)
  for (const [modelId, profile] of Object.entries(provider.modelProfiles)) {
    const normalized = normalizeModelKey(modelId)
    if (!normalized || !isProviderComposerChatModelId(provider, normalized)) continue
    profiles[normalized] = {
      ...profile,
      contextWindowTokens: profile.contextWindowTokens ?? DEFAULT_PROVIDER_CONTEXT_WINDOW_TOKENS
    }
  }
  return profiles
}

export function modelSupportsImageInput(
  profile: Pick<ModelProviderModelProfileV1, 'inputModalities'> | undefined
): boolean {
  return profile?.inputModalities.includes('image') === true
}

export function modelReasoningEfforts(
  profile: Pick<ModelProviderModelProfileV1, 'reasoning'> | undefined
): ModelProviderReasoningCapabilityV1 | undefined {
  return profile?.reasoning
}

export function listImageGenerationProviderProfiles(settings: AppSettingsV1): ModelProviderProfileV1[] {
  return getModelProviderSettings(settings).providers.filter((provider) => Boolean(provider.image))
}

export function listSpeechToTextProviderProfiles(settings: AppSettingsV1): ModelProviderProfileV1[] {
  return getModelProviderSettings(settings).providers.filter((provider) => Boolean(provider.speech))
}

export function listTextToSpeechProviderProfiles(settings: AppSettingsV1): ModelProviderProfileV1[] {
  return getModelProviderSettings(settings).providers.filter((provider) => Boolean(provider.textToSpeech))
}

export function listMusicGenerationProviderProfiles(settings: AppSettingsV1): ModelProviderProfileV1[] {
  return getModelProviderSettings(settings).providers.filter((provider) => Boolean(provider.music))
}

export function listVideoGenerationProviderProfiles(settings: AppSettingsV1): ModelProviderProfileV1[] {
  return getModelProviderSettings(settings).providers.filter((provider) => Boolean(provider.video))
}
