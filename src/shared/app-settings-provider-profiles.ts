import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_IMAGE_GENERATION_PROTOCOL,
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  DEFAULT_MODEL_PROVIDER_ID,
  DEFAULT_MODEL_REQUEST_RETRY_HTTP_STATUS_CODES,
  DEFAULT_MODEL_REQUEST_RETRY_INITIAL_DELAY_MS,
  DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS,
  MODEL_REQUEST_RETRY_DEFAULTS_VERSION,
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
  normalizeModelKey,
  normalizeModelProviderBaseUrl,
  normalizeModelProviderId,
  normalizeModelProviderImageCapability,
  normalizeModelProviderModelProfile,
  normalizeModelProviderModelProfiles,
  normalizeModelProviderMusicCapability,
  normalizeModelProviderSpeechCapability,
  normalizeModelProviderTextToSpeechCapability,
  normalizeModelProviderVideoCapability,
  normalizeProviderModels,
  presetModelProfilesForProvider
} from './app-settings-provider-capabilities'
import {
  DEFAULT_MODEL_PROVIDER_NAME,
  DEFAULT_TEXT_MODEL_PROFILE
} from './app-settings-provider-core'
import {
  providerWithPresetCapabilities
} from './app-settings-provider-media'
import {
  sameModelIds
} from './app-settings-provider-runtime'

export function defaultModelProviderProfile(apiKey: string, baseUrl: string): ModelProviderProfileV1 {
  return {
    id: DEFAULT_MODEL_PROVIDER_ID,
    name: DEFAULT_MODEL_PROVIDER_NAME,
    apiKey: apiKey.trim(),
    baseUrl: normalizeModelProviderBaseUrl(baseUrl),
    endpointFormat: DEFAULT_MODEL_ENDPOINT_FORMAT,
    retry: defaultModelRequestRetrySettings(),
    models: [...DEFAULT_COMPOSER_MODEL_IDS],
    modelProfiles: {
      'deepseek-v4-pro': deepseekTextModelProfile(),
      'deepseek-v4-flash': {
        ...deepseekTextModelProfile(),
        aliases: ['deepseek-chat', 'deepseek-reasoner']
      }
    }
  }
}

export function normalizeModelProviderProfile(
  input: ModelProviderProfilePatchV1 | undefined
): ModelProviderProfileV1 | null {
  const id = normalizeModelProviderId(input?.id)
  if (!id) return null
  const presetSource = id === OPENCODE_FREE_PROVIDER_ID
    ? { presetId: OPENCODE_FREE_PROVIDER_ID, mode: 'api' as const }
    : normalizeModelProviderPresetSource(input, id)
  const resolvedPresetSource = presetSource
    ? resolveModelProviderPresetSource({ id, presetSource })
    : null
  const kind =
    input?.kind === 'gemini-code-assist'
      ? 'antigravity-cli'
      : input?.kind ?? (
          resolvedPresetSource?.mode === 'api'
            ? resolvedPresetSource.preset.kind
            : undefined
        )
  const rawName = typeof input?.name === 'string' && input.name.trim() ? input.name.trim() : id
  const rawBaseUrl = normalizeModelProviderBaseUrl(input?.baseUrl)
  const rawEndpointFormat = normalizeModelEndpointFormat(input?.endpointFormat)
  const savedModels = normalizeProviderModels(input?.models)
  // Existing builds used `gemini-code-assist` on the legacy Antigravity preset.
  // Keep that one-time migration on Antigravity; the new direct Gemini CLI API
  // preset has its own id and never silently takes ownership of legacy threads.
  const rawModels =
    presetSource?.presetId === 'gemini-subscription' && input?.kind === 'gemini-code-assist'
      ? [...GEMINI_SUBSCRIPTION_MODEL_IDS]
      : savedModels
  const migrated = migrateChatGptSubscriptionProfile(
    id,
    rawName,
    rawModels,
    rawBaseUrl,
    rawEndpointFormat
  )
  const name = migrated.name
  const baseUrl = migrated.baseUrl
  const endpointFormat = migrated.endpointFormat
  const models = migrateProviderPresetModelCatalog(id, migrated.models)
  const modelProfiles = withPresetModelProfiles(
    { id, presetSource },
    models,
    normalizeModelProviderModelProfiles(input?.modelProfiles, models)
  )
  const image = normalizeModelProviderImageCapability(input?.image)
  const speech = normalizeModelProviderSpeechCapability(input?.speech)
  const textToSpeech = normalizeModelProviderTextToSpeechCapability(input?.textToSpeech)
  const music = normalizeModelProviderMusicCapability(input?.music)
  const video = normalizeModelProviderVideoCapability(input?.video)
  return providerWithPresetCapabilities({
    id,
    name,
    ...(presetSource ? { presetSource } : {}),
    apiKey:
      kind === 'antigravity-cli' || kind === 'gemini-cli-api'
        ? ''
        : typeof input?.apiKey === 'string'
          ? input.apiKey.trim()
          : '',
    baseUrl,
    endpointFormat,
    retry: normalizeModelRequestRetrySettings(
      input?.retry,
      resolvedPresetSource?.mode === 'api'
        ? resolvedPresetSource.preset.defaultRetryMaxAttempts
        : undefined
    ),
    ...(kind ? { kind } : {}),
    models,
    modelProfiles,
    ...(image ? { image } : {}),
    ...(speech ? { speech } : {}),
    ...(textToSpeech ? { textToSpeech } : {}),
    ...(music ? { music } : {}),
    ...(video ? { video } : {})
  })
}

export function normalizeModelProviderPresetSource(
  input: ModelProviderProfilePatchV1 | undefined,
  id: string
): ModelProviderPresetSourceV1 | undefined {
  const raw = input?.presetSource
  if (raw !== undefined) {
    if (!raw || typeof raw !== 'object') return undefined
    const presetId = typeof raw.presetId === 'string' ? raw.presetId.trim() : ''
    const mode = raw.mode === 'api' || raw.mode === 'token-plan' ? raw.mode : undefined
    if (!presetId || !mode) return undefined
    const resolved = resolveModelProviderPresetSource({ id, presetSource: { presetId, mode } })
    return resolved ? { presetId: resolved.preset.id, mode: resolved.mode } : undefined
  }
  const inferred = resolveModelProviderPresetSource({ id })
  return inferred ? { presetId: inferred.preset.id, mode: inferred.mode } : undefined
}

export const CHATGPT_SUBSCRIPTION_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

export function isChatGptSubscriptionCodexBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return url.protocol === 'https:' &&
      url.hostname === 'chatgpt.com' &&
      url.pathname.replace(/\/+$/u, '').startsWith('/backend-api/codex')
  } catch {
    return false
  }
}

export function migrateChatGptSubscriptionProfile(
  id: string,
  name: string,
  models: string[],
  baseUrl: string,
  endpointFormat: ModelEndpointFormat
): {
  name: string
  models: string[]
  baseUrl: string
  endpointFormat: ModelEndpointFormat
} {
  if (id !== CHATGPT_SUBSCRIPTION_PROVIDER_ID) {
    return { name, models, baseUrl, endpointFormat }
  }
  const migrateEndpoint = isChatGptSubscriptionCodexBaseUrl(baseUrl)
  return {
    name: name === CHATGPT_SUBSCRIPTION_LEGACY_NAME ? CHATGPT_SUBSCRIPTION_NAME : name,
    // This is intentionally a precise one-time signature migration. Do not
    // re-add models that a user deliberately removed from a custom list.
    models: sameModelIds(models, CHATGPT_SUBSCRIPTION_LEGACY_MODEL_IDS)
      ? [...CHATGPT_SUBSCRIPTION_MODEL_IDS]
      : models,
    // Older builds stored `.../codex` + `responses`, which CompatModelClient
    // would expand to the broken `.../codex/v1/responses` path.
    baseUrl: migrateEndpoint ? CHATGPT_SUBSCRIPTION_RESPONSES_URL : baseUrl,
    endpointFormat: migrateEndpoint ? 'custom_endpoint' : endpointFormat
  }
}

export function migrateProviderPresetModelCatalog(id: string, models: string[]): string[] {
  if (id !== 'kimi-code') return models
  const legacyModels = new Set(['kimi-for-coding', 'kimi-for-coding-highspeed'])
  if (models.length === 0 || models.some((model) => !legacyModels.has(model))) return models
  const preset = getModelProviderPreset('kimi-code')
  return preset ? [...preset.models] : models
}

export function defaultModelRequestRetrySettings(): ModelRequestRetrySettingsV1 {
  return {
    maxAttempts: DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS,
    initialDelayMs: DEFAULT_MODEL_REQUEST_RETRY_INITIAL_DELAY_MS,
    httpStatusCodes: [...DEFAULT_MODEL_REQUEST_RETRY_HTTP_STATUS_CODES],
    defaultsVersion: MODEL_REQUEST_RETRY_DEFAULTS_VERSION
  }
}

export function normalizeModelRequestRetrySettings(
  input: Partial<ModelRequestRetrySettingsV1> | undefined,
  defaultMaxAttempts?: number
): ModelRequestRetrySettingsV1 {
  const defaults = {
    ...defaultModelRequestRetrySettings(),
    ...(defaultMaxAttempts === undefined
      ? {}
      : { maxAttempts: boundedNonNegativeInteger(defaultMaxAttempts, DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS, 10) })
  }
  const httpStatusCodes = normalizeRetryHttpStatusCodes(input?.httpStatusCodes, defaults.httpStatusCodes)
  const defaultsVersion = boundedNonNegativeInteger(input?.defaultsVersion, 0, 1_000)
  const maxAttempts = boundedNonNegativeInteger(input?.maxAttempts, defaults.maxAttempts, 10)
  const inheritedLegacyZeroRetryBudget =
    defaultsVersion < MODEL_REQUEST_RETRY_DEFAULTS_VERSION && maxAttempts === 0
  const inheritedLegacyStatusList =
    defaultsVersion < MODEL_REQUEST_RETRY_DEFAULTS_VERSION &&
    sameRetryHttpStatusCodes(httpStatusCodes, [429, 503])
  return {
    // Retry settings originally shipped with a zero default. Re-enable the
    // current five-retry default once for pre-v2 profiles; v2+ zero remains
    // the user's explicit opt-out.
    maxAttempts: inheritedLegacyZeroRetryBudget
      ? DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS
      : maxAttempts,
    initialDelayMs: boundedNonNegativeInteger(input?.initialDelayMs, defaults.initialDelayMs, 600_000),
    httpStatusCodes: inheritedLegacyStatusList ? [...defaults.httpStatusCodes] : httpStatusCodes,
    defaultsVersion: Math.max(defaultsVersion, MODEL_REQUEST_RETRY_DEFAULTS_VERSION)
  }
}

function sameRetryHttpStatusCodes(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((code, index) => code === right[index])
}

export function normalizeRetryHttpStatusCodes(input: unknown, fallback: readonly number[]): number[] {
  const values = Array.isArray(input) ? input : fallback
  const codes = new Set<number>()
  for (const raw of values) {
    const code = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isInteger(code) || code < 400 || code > 599) continue
    codes.add(code)
  }
  return codes.size > 0 ? [...codes].sort((a, b) => a - b) : [...fallback]
}

export function boundedNonNegativeInteger(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(0, Math.round(num)))
}

export function deepseekTextModelProfile(): ModelProviderModelProfileV1 {
  return {
    ...DEFAULT_TEXT_MODEL_PROFILE,
    contextWindowTokens: 1_000_000,
    reasoning: {
      supportedEfforts: ['off', 'high', 'max'],
      defaultEffort: 'max',
      requestProtocol: 'deepseek-chat-completions'
    }
  }
}

/**
 * Stored provider settings may predate the capability metadata in the presets
 * (older saves carry empty modelProfiles). For known preset providers the
 * preset fills missing profiles, while stored profiles win so model edits made
 * in Settings keep surviving normalization.
 */
export function withPresetModelProfiles(
  provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>,
  models: readonly string[],
  stored: Record<string, ModelProviderModelProfileV1>
): Record<string, ModelProviderModelProfileV1> {
  const presetProfiles = presetModelProfilesForProvider(provider)
  if (!presetProfiles) return stored
  const knownModelKeys = new Set(models.map(normalizeModelKey).filter(Boolean))
  const merged: Record<string, ModelProviderModelProfileV1> = {}
  for (const [rawModelId, presetProfile] of Object.entries(presetProfiles)) {
    const modelId = normalizeModelKey(rawModelId)
    if (!modelId) continue
    if (knownModelKeys.size > 0 && !knownModelKeys.has(modelId)) {
      const aliases = normalizeProviderModels(presetProfile.aliases)
      if (!aliases.some((alias) => knownModelKeys.has(normalizeModelKey(alias)))) continue
    }
    merged[modelId] = normalizeModelProviderModelProfile(presetProfile)
  }
  const profiles = { ...stored }
  for (const [modelId, presetProfile] of Object.entries(merged)) {
    const storedProfile = stored[modelId]
    const usePresetReasoning = shouldUpgradeGeneratedPresetReasoning(
      provider.id,
      modelId,
      storedProfile?.reasoning,
      presetProfile.reasoning
    )
    const repairKnownGrokCapacity = shouldRepairKnownOpenCodeGrokCapacity(
      provider,
      modelId,
      storedProfile,
      presetProfile
    )
    const profile: ModelProviderModelProfileV1 = {
      ...presetProfile,
      ...(storedProfile ?? {}),
      ...(usePresetReasoning && presetProfile.reasoning
        ? { reasoning: presetProfile.reasoning }
        : {}),
      // Service-tier availability is upstream model metadata. Older stored
      // profiles must inherit additions and removals from the preset catalog.
      ...(presetProfile.serviceTiers?.length
        ? { serviceTiers: [...presetProfile.serviceTiers] }
        : {}),
      // Catalog reference pricing is upstream metadata, not a user-editable
      // profile choice; stored profiles inherit it from the preset catalog.
      ...(presetProfile.pricing ? { pricing: { ...presetProfile.pricing } } : {}),
      // Responses Lite is a required transport contract for its matching
      // Codex models, not a user-editable profile choice. Older manually
      // added profiles should inherit it from the preset.
      ...(presetProfile.responsesMode && !storedProfile?.responsesMode
        ? { responsesMode: presetProfile.responsesMode }
        : {}),
      ...(repairKnownGrokCapacity
        ? {
            contextWindowTokens: presetProfile.contextWindowTokens!,
            maxOutputTokens: presetProfile.maxOutputTokens!
          }
        : {})
    }
    if (!presetProfile.serviceTiers?.length) delete profile.serviceTiers
    profiles[modelId] = profile
  }
  return profiles
}

export function shouldRepairKnownOpenCodeGrokCapacity(
  provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>,
  modelId: string,
  stored: ModelProviderModelProfileV1 | undefined,
  preset: ModelProviderModelProfileV1
): boolean {
  const source = resolveModelProviderPresetSource(provider)
  return source?.preset.id === 'opencode-go' &&
    modelId === 'grok-4.5' &&
    stored?.contextWindowTokens === 256_000 &&
    stored.maxOutputTokens === 500_000 &&
    preset.contextWindowTokens === 500_000 &&
    preset.maxOutputTokens === 64_000
}

export function shouldUpgradeGeneratedPresetReasoning(
  providerId: string,
  modelId: string,
  stored: ModelProviderReasoningCapabilityV1 | undefined,
  preset: ModelProviderReasoningCapabilityV1 | undefined
): boolean {
  if (!stored || !preset) return false
  const presetId = providerId.endsWith(TOKEN_PLAN_PROVIDER_ID_SUFFIX)
    ? providerId.slice(0, -TOKEN_PLAN_PROVIDER_ID_SUFFIX.length)
    : providerId
  if (
    presetId === 'kimi-code' &&
    modelId === 'k3' &&
    stored.requestProtocol === 'openai-responses' &&
    preset.requestProtocol === 'openai-chat-completions'
  ) {
    return true
  }
  const generatedPlaceholderProviders = new Set([
    'opencode-go',
    'zhipu-coding-plan',
    'zai-coding-plan',
    'aliyun',
    'tencentcloud',
    'volcengine-coding-plan'
  ])
  if (!generatedPlaceholderProviders.has(presetId)) return false
  return stored.requestProtocol === 'none' &&
    preset.requestProtocol !== 'none' &&
    stored.defaultEffort === 'auto' &&
    stored.supportedEfforts.every((effort) => effort === 'auto' || effort === 'off')
}
