import type {
  ImageGenerationProtocol,
  MusicGenerationProtocol,
  ModelEndpointFormat,
  ModelProviderImageCapabilityV1,
  ModelProviderMusicCapabilityV1,
  ModelProviderModelProfileV1,
  ModelProviderPresetMode,
  ModelProviderProfileV1,
  ModelProviderReasoningCapabilityV1,
  ModelProviderSpeechCapabilityV1,
  ModelProviderTextToSpeechCapabilityV1,
  ModelProviderVideoCapabilityV1,
  SpeechToTextProtocol,
  TextToSpeechProtocol,
  VideoGenerationProtocol
} from './app-settings-types'
import {
  DEFAULT_MODEL_REQUEST_RETRY_HTTP_STATUS_CODES,
  DEFAULT_MODEL_REQUEST_RETRY_INITIAL_DELAY_MS,
  DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS,
  MODEL_REQUEST_RETRY_DEFAULTS_VERSION
} from './app-settings-types'
import {
  CODEX_RESPONSES_REASONING,
  MINIMAX_BUILT_IN_REASONING,
  MINIMAX_M3_REASONING,
  ModelProviderPreset,
  ModelProviderTokenPlanPreset,
  TOKEN_PLAN_PROVIDER_ID_SUFFIX,
  XIAOMI_REASONING
} from './model-provider-preset-types'
import { MODEL_PROVIDER_PRESETS } from './model-provider-preset-catalog'

import {
  copyModelProfiles,
  escapeRegExp,
  modelProviderPresetImageCapability,
  modelProviderPresetMusicCapability,
  modelProviderPresetSpeechCapability,
  modelProviderPresetTextToSpeechCapability,
  modelProviderPresetVideoCapability,
  tokenPlanCapabilityBaseUrl
} from './model-provider-preset-profile-builders'

export function getModelProviderPreset(id: string): ModelProviderPreset | null {
  return MODEL_PROVIDER_PRESETS.find((preset) => preset.id === id) ?? null
}

export function defaultPresetRetrySettings(
  preset?: Pick<ModelProviderPreset, 'defaultRetryMaxAttempts'>
) {
  return {
    maxAttempts: preset?.defaultRetryMaxAttempts ?? DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS,
    initialDelayMs: DEFAULT_MODEL_REQUEST_RETRY_INITIAL_DELAY_MS,
    httpStatusCodes: [...DEFAULT_MODEL_REQUEST_RETRY_HTTP_STATUS_CODES],
    defaultsVersion: MODEL_REQUEST_RETRY_DEFAULTS_VERSION
  }
}

export function modelProviderPresetProfile(
  preset: ModelProviderPreset,
  apiKey = ''
): ModelProviderProfileV1 {
  return {
    id: preset.id,
    name: preset.name,
    presetSource: { presetId: preset.id, mode: 'api' },
    apiKey: apiKey.trim(),
    baseUrl: preset.baseUrl,
    endpointFormat: preset.endpointFormat,
    useProxy: false,
    // Subscription and API transports share the same bounded default. An
    // explicit provider setting can still reduce or disable retries.
    retry: defaultPresetRetrySettings(preset),
    ...(preset.kind ? { kind: preset.kind } : {}),
    models: [...preset.models],
    modelProfiles: copyModelProfiles(preset.modelProfiles),
    ...(preset.image ? { image: modelProviderPresetImageCapability(preset.image) } : {}),
    ...(preset.speech ? { speech: modelProviderPresetSpeechCapability(preset.speech) } : {}),
    ...(preset.textToSpeech
      ? { textToSpeech: modelProviderPresetTextToSpeechCapability(preset.textToSpeech) }
      : {}),
    ...(preset.music ? { music: modelProviderPresetMusicCapability(preset.music) } : {}),
    ...(preset.video ? { video: modelProviderPresetVideoCapability(preset.video) } : {})
  }
}

export function tokenPlanProviderId(presetId: string): string {
  return `${presetId}${TOKEN_PLAN_PROVIDER_ID_SUFFIX}`
}

export function modelProviderTokenPlanProfile(
  preset: ModelProviderPreset,
  apiKey = '',
  baseUrl = ''
): ModelProviderProfileV1 | null {
  const tokenPlan = preset.tokenPlan
  if (!tokenPlan) return null
  const resolvedBaseUrl = baseUrl.trim() || tokenPlan.baseUrl
  return {
    id: tokenPlanProviderId(preset.id),
    name: tokenPlan.displayName?.trim() || `${preset.name} Token Plan`,
    presetSource: { presetId: preset.id, mode: 'token-plan' },
    apiKey: apiKey.trim(),
    baseUrl: resolvedBaseUrl,
    endpointFormat: tokenPlan.endpointFormat,
    useProxy: false,
    retry: defaultPresetRetrySettings(preset),
    models: [...tokenPlan.models],
    modelProfiles: copyModelProfiles(tokenPlan.modelProfiles),
    ...(tokenPlan.image
      ? {
          image: {
            protocol: tokenPlan.image.protocol,
            baseUrl: tokenPlanCapabilityBaseUrl(tokenPlan, resolvedBaseUrl, tokenPlan.image.baseUrl),
            models: [...tokenPlan.image.models]
          }
        }
      : {}),
    ...(tokenPlan.speech
      ? {
          speech: {
            protocol: tokenPlan.speech.protocol,
            baseUrl: resolvedBaseUrl,
            models: [...tokenPlan.speech.models]
          }
        }
      : {}),
    ...(tokenPlan.textToSpeech
      ? {
          textToSpeech: {
            protocol: tokenPlan.textToSpeech.protocol,
            baseUrl: tokenPlanCapabilityBaseUrl(tokenPlan, resolvedBaseUrl, tokenPlan.textToSpeech.baseUrl),
            models: [...tokenPlan.textToSpeech.models]
          }
        }
      : {}),
    ...(tokenPlan.music
      ? {
          music: {
            protocol: tokenPlan.music.protocol,
            baseUrl: tokenPlanCapabilityBaseUrl(tokenPlan, resolvedBaseUrl, tokenPlan.music.baseUrl),
            models: [...tokenPlan.music.models]
          }
        }
      : {}),
    ...(tokenPlan.video
      ? {
          video: {
            protocol: tokenPlan.video.protocol,
            baseUrl: tokenPlanCapabilityBaseUrl(tokenPlan, resolvedBaseUrl, tokenPlan.video.baseUrl),
            models: [...tokenPlan.video.models]
          }
        }
      : {})
  }
}

export type ResolvedModelProviderPresetSource = {
  preset: ModelProviderPreset
  mode: ModelProviderPresetMode
}

/**
 * Resolves a persisted profile back to its built-in preset. Explicit source
 * metadata supports multi-account ids; exact legacy ids remain compatible.
 */
export function resolveModelProviderPresetSource(
  profile: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>
): ResolvedModelProviderPresetSource | null {
  const explicit = profile.presetSource
  if (explicit) {
    const preset = getModelProviderPreset(explicit.presetId)
    if (!preset || (explicit.mode === 'token-plan' && !preset.tokenPlan)) return null
    return { preset, mode: explicit.mode }
  }
  const direct = getModelProviderPreset(profile.id)
  if (direct) return { preset: direct, mode: 'api' }
  const numbered = /^(.*)-(?:[2-9]|[1-9][0-9]+)$/u.exec(profile.id)?.[1]
  const candidateId = numbered ?? profile.id
  const tokenPlan = candidateId.endsWith(TOKEN_PLAN_PROVIDER_ID_SUFFIX)
  const presetId = tokenPlan
    ? candidateId.slice(0, -TOKEN_PLAN_PROVIDER_ID_SUFFIX.length)
    : candidateId
  const preset = getModelProviderPreset(presetId)
  return preset && (!tokenPlan || preset.tokenPlan)
    ? { preset, mode: tokenPlan ? 'token-plan' : 'api' }
    : null
}

export function isMultiAccountProviderPreset(
  preset: ModelProviderPreset,
  mode: ModelProviderPresetMode
): boolean {
  return mode === 'token-plan' || preset.category === 'subscription'
}

export function modelProviderPresetAccountCount(
  preset: ModelProviderPreset,
  mode: ModelProviderPresetMode,
  providers: readonly Pick<ModelProviderProfileV1, 'id' | 'name' | 'presetSource'>[]
): number {
  return providers.filter((provider) => {
    const source = resolveModelProviderPresetSource(provider)
    return source?.preset.id === preset.id && source.mode === mode
  }).length
}

/** Builds the next independent account profile for a preset/mode family. */
export function modelProviderPresetAccountProfile(
  preset: ModelProviderPreset,
  mode: ModelProviderPresetMode,
  providers: readonly Pick<ModelProviderProfileV1, 'id' | 'name' | 'presetSource'>[]
): ModelProviderProfileV1 | null {
  const base = mode === 'token-plan'
    ? modelProviderTokenPlanProfile(preset)
    : modelProviderPresetProfile(preset)
  if (!base) return null
  const family = providers.filter((provider) => {
    const source = resolveModelProviderPresetSource(provider)
    return source?.preset.id === preset.id && source.mode === mode
  })
  const idPattern = new RegExp(`^${escapeRegExp(base.id)}-(\\d+)$`)
  const namePattern = new RegExp(`^${escapeRegExp(base.name)} (\\d+)$`, 'i')
  let highestOrdinal = 0
  for (const provider of family) {
    highestOrdinal = Math.max(
      highestOrdinal,
      provider.id === base.id ? 1 : Number(idPattern.exec(provider.id)?.[1] ?? 0),
      provider.name.toLowerCase() === base.name.toLowerCase() ? 1 : Number(namePattern.exec(provider.name)?.[1] ?? 0)
    )
  }
  let ordinal = family.length === 0 ? 1 : Math.max(highestOrdinal, family.length) + 1
  const usedIds = new Set(providers.map((provider) => provider.id.toLowerCase()))
  const usedNames = new Set(providers.map((provider) => provider.name.trim().toLowerCase()).filter(Boolean))
  while (true) {
    const id = ordinal === 1 ? base.id : `${base.id}-${ordinal}`
    const name = ordinal === 1 ? base.name : `${base.name} ${ordinal}`
    if (!usedIds.has(id.toLowerCase()) && !usedNames.has(name.toLowerCase())) {
      return { ...base, id, name }
    }
    ordinal += 1
  }
}
