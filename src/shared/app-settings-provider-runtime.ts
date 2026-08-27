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
  normalizeImageGenerationProtocol,
  normalizeModelProviderId
} from './app-settings-provider-capabilities'
import {
  getModelProviderProfile,
  getModelProviderSettings,
  modelProviderModelProfilesForProvider
} from './app-settings-provider-core'
import {
  resolveKunMusicGenerationSettings,
  resolveKunSpeechToTextSettings,
  resolveKunTextToSpeechSettings,
  resolveKunVideoGenerationSettings,
  resolveProviderCapabilityBaseUrl
} from './app-settings-provider-media'
import {
  defaultModelRequestRetrySettings
} from './app-settings-provider-profiles'

export function resolveKunMemoryEnabled(settings: AppSettingsV1): boolean {
  const runtime = getKunRuntimeSettings(settings)
  return runtime.memoryEnabled ?? false
}

export function resolveProviderCapabilityModel(configuredModel: string, providerModels: readonly string[]): string {
  const model = configuredModel.trim()
  if (!model) return providerModels[0] ?? ''
  if (providerModels.length === 0) return model
  return providerModels.some((providerModel) => providerModel.trim().toLowerCase() === model.toLowerCase())
    ? model
    : providerModels[0] ?? model
}

export function resolveImageProviderCapabilityModel(
  configuredModel: string,
  image: ModelProviderImageCapabilityV1
): string {
  const fallback =
    image.protocol === 'codex-responses-image' && image.models.includes('gpt-image-2')
      ? 'gpt-image-2'
      : image.models[0] ?? ''
  const model = configuredModel.trim()
  if (!model) return fallback
  if (image.models.length === 0) return model
  return image.models.some((providerModel) => providerModel.trim().toLowerCase() === model.toLowerCase())
    ? model
    : fallback || model
}

export function tokenPlanPresetForProvider(
  provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>
) {
  const source = resolveModelProviderPresetSource(provider)
  return source?.mode === 'token-plan' ? source.preset : null
}

export function sameModelIds(a: readonly string[], b: readonly string[]): boolean {
  const left = a.map((model) => model.trim().toLowerCase()).filter(Boolean).sort()
  const right = b.map((model) => model.trim().toLowerCase()).filter(Boolean).sort()
  return left.length === right.length && left.every((model, index) => model === right[index])
}

export function canonicalBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function resolveKunImageGenerationSettings(settings: AppSettingsV1): KunImageGenerationSettingsV1 {
  const runtime = getKunRuntimeSettings(settings)
  const imageGeneration = runtime.imageGeneration
  const providerId = normalizeModelProviderId(imageGeneration.providerId)
  if (!providerId || providerId === CUSTOM_IMAGE_GENERATION_PROVIDER_ID) {
    return normalizeResolvedImageDefaults({
      ...imageGeneration,
      providerId,
      protocol: normalizeImageGenerationProtocol(imageGeneration.protocol)
    })
  }
  const provider = getModelProviderSettings(settings).providers.find((item) => item.id === providerId)
  const image = provider?.image
  if (!provider || !image) {
    return {
      ...imageGeneration,
      providerId: '',
      apiKey: '',
      protocol: normalizeImageGenerationProtocol(imageGeneration.protocol)
    }
  }
  return normalizeResolvedImageDefaults({
    ...imageGeneration,
    providerId: provider.id,
    protocol: image.protocol,
    baseUrl: resolveProviderCapabilityBaseUrl(provider, image, 'image'),
    apiKey: provider.apiKey.trim(),
    model: resolveImageProviderCapabilityModel(imageGeneration.model, image)
  })
}

export function normalizeResolvedImageDefaults(
  value: KunImageGenerationSettingsV1
): KunImageGenerationSettingsV1 {
  if (value.protocol === 'volcengine-ark-image') {
    return {
      ...value,
      defaultResolution: value.defaultResolution === '3K' || value.defaultResolution === '4K'
        ? value.defaultResolution
        : '2K'
    }
  }
  return value.defaultResolution === '3K' || value.defaultResolution === '4K'
    ? { ...value, defaultResolution: '1K' }
    : value
}

export function resolveKunRuntimeSettings(settings: AppSettingsV1): KunRuntimeSettingsV1 {
  const runtime = getKunRuntimeSettings(settings)
  const provider = getModelProviderProfile(settings, runtime.providerId)
  const providerId = normalizeModelProviderId(runtime.providerId)
  const runtimeApiKey = runtime.apiKey?.trim() ?? ''
  const runtimeBaseUrl = runtime.baseUrl?.trim() ?? ''
  const providerBaseUrl = provider.baseUrl.trim() || DEFAULT_DEEPSEEK_BASE_URL
  const useProviderCredentials = Boolean(providerId)
  const useOpenCodeAnonymousAccess =
    (
      provider.id === OPENCODE_FREE_PROVIDER_ID ||
      resolveModelProviderPresetSource(provider)?.preset.id === OPENCODE_FREE_PROVIDER_ID
    ) &&
    !provider.apiKey.trim()

  return {
    ...runtime,
    // OpenCode Zen free models authenticate by omitting the credential header
    // entirely; a placeholder bearer would be treated as a real (unknown) key
    // and rejected with 401. Never fall back to a stale runtime key here — that
    // would silently attach an unrelated DeepSeek credential to the free tier.
    apiKey: useOpenCodeAnonymousAccess
      ? ''
      : useProviderCredentials
        ? provider.apiKey.trim() || runtimeApiKey
        : runtimeApiKey || provider.apiKey.trim(),
    baseUrl:
      !useProviderCredentials && runtimeBaseUrl && runtimeBaseUrl !== DEFAULT_DEEPSEEK_BASE_URL
        ? normalizeDeepseekBaseUrl(runtimeBaseUrl)
        : normalizeDeepseekBaseUrl(providerBaseUrl),
    endpointFormat: provider.endpointFormat,
    retry: provider.retry ?? defaultModelRequestRetrySettings(),
    imageGeneration: resolveKunImageGenerationSettings(settings),
    speechToText: resolveKunSpeechToTextSettings(settings),
    textToSpeech: resolveKunTextToSpeechSettings(settings),
    musicGeneration: resolveKunMusicGenerationSettings(settings),
    videoGeneration: resolveKunVideoGenerationSettings(settings),
    modelProfiles: modelProviderModelProfilesForProvider(settings, provider.id),
    memoryEnabled: resolveKunMemoryEnabled(settings)
  }
}
