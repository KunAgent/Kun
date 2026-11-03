import { metadataEvidence } from '../../kun/src/contracts/model-metadata-evidence.js'
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
  DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS
} from './app-settings-types'
import {
  CODEX_RESPONSES_REASONING,
  MINIMAX_BUILT_IN_REASONING,
  MINIMAX_M31_FLASH_REASONING,
  MINIMAX_M3_REASONING,
  ModelProviderPreset,
  ModelProviderTokenPlanPreset,
  TOKEN_PLAN_PROVIDER_ID_SUFFIX,
  XIAOMI_REASONING
} from './model-provider-preset-types'
import { MODEL_PROVIDER_PRESETS } from './model-provider-preset-catalog'

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function tokenPlanCapabilityBaseUrl(
  tokenPlan: ModelProviderTokenPlanPreset,
  resolvedBaseUrl: string,
  capabilityBaseUrl: string | undefined
): string {
  const fallback = capabilityBaseUrl?.trim() || resolvedBaseUrl
  if (!capabilityBaseUrl?.trim()) return resolvedBaseUrl
  const resolvedOrigin = urlOrigin(resolvedBaseUrl)
  const capabilityOrigin = urlOrigin(capabilityBaseUrl)
  if (!resolvedOrigin || !capabilityOrigin) return fallback
  const planOrigins = [
    tokenPlan.baseUrl,
    ...(tokenPlan.regions?.map((region) => region.baseUrl) ?? [])
  ].map(urlOrigin).filter((origin): origin is string => Boolean(origin))
  if (!planOrigins.includes(capabilityOrigin)) return fallback
  return replaceUrlOrigin(capabilityBaseUrl, resolvedOrigin)
}

export function urlOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null
  try {
    return new URL(value.trim()).origin
  } catch {
    return null
  }
}

export function replaceUrlOrigin(value: string, origin: string): string {
  try {
    const url = new URL(value.trim())
    const path = url.pathname.replace(/\/+$/, '')
    return `${origin}${path === '/' ? '' : path}${url.search}`
  } catch {
    return value.trim()
  }
}

export function xiaomiTextChatProfile(contextWindowTokens: number): ModelProviderModelProfileV1 {
  return textChatProfile(contextWindowTokens, XIAOMI_REASONING)
}

export function xiaomiVisionChatProfile(contextWindowTokens: number): ModelProviderModelProfileV1 {
  return visionChatProfile(contextWindowTokens, XIAOMI_REASONING)
}

export function minimaxM31FlashChatProfile(): ModelProviderModelProfileV1 {
  return visionChatProfile(1_000_000, MINIMAX_M31_FLASH_REASONING)
}

export function minimaxM3ChatProfile(): ModelProviderModelProfileV1 {
  return visionChatProfile(1_000_000, MINIMAX_M3_REASONING)
}

export function minimaxM2ChatProfile(): ModelProviderModelProfileV1 {
  return textChatProfile(204_800, MINIMAX_BUILT_IN_REASONING)
}

export function textChatProfile(
  contextWindowTokens?: number,
  reasoning?: ModelProviderReasoningCapabilityV1,
  endpointFormat?: ModelEndpointFormat
): ModelProviderModelProfileV1 {
  return {
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text'],
    ...(reasoning ? { reasoning } : {}),
    ...(endpointFormat ? { endpointFormat } : {})
  }
}

export function visionChatProfile(
  contextWindowTokens?: number,
  reasoning?: ModelProviderReasoningCapabilityV1,
  endpointFormat?: ModelEndpointFormat
): ModelProviderModelProfileV1 {
  return {
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text', 'image_url'],
    ...(reasoning ? { reasoning } : {}),
    ...(endpointFormat ? { endpointFormat } : {})
  }
}

export function codexLiteVisionChatProfile(contextWindowTokens: number): ModelProviderModelProfileV1 {
  return {
    ...visionChatProfile(contextWindowTokens, CODEX_RESPONSES_REASONING),
    responsesMode: 'lite'
  }
}

export function withPriorityServiceTier(
  profile: ModelProviderModelProfileV1
): ModelProviderModelProfileV1 {
  return {
    ...profile,
    serviceTiers: ['priority']
  }
}

export function copyModelProfiles(
  profiles: Record<string, ModelProviderModelProfileV1> | undefined
): Record<string, ModelProviderModelProfileV1> {
  if (!profiles) return {}
  return Object.fromEntries(
    Object.entries(profiles).map(([modelId, profile]) => [
      modelId,
      {
        ...profile,
        evidence: profile.evidence ?? metadataEvidence(profile, 'adapter'),
        ...(profile.aliases ? { aliases: [...profile.aliases] } : {}),
        inputModalities: [...profile.inputModalities],
        outputModalities: [...profile.outputModalities],
        messageParts: [...profile.messageParts],
        ...(profile.serviceTiers ? { serviceTiers: [...profile.serviceTiers] } : {}),
        ...(profile.reasoning
          ? {
              reasoning: {
                ...profile.reasoning,
                supportedEfforts: [...profile.reasoning.supportedEfforts],
                defaultEffort: profile.reasoning.defaultEffort,
                requestProtocol: profile.reasoning.requestProtocol
              }
            }
          : {})
      }
    ])
  )
}

export function modelProviderPresetImageCapability(
  image: NonNullable<ModelProviderPreset['image']>
): ModelProviderImageCapabilityV1 {
  return {
    protocol: image.protocol,
    baseUrl: image.baseUrl,
    models: [...image.models]
  }
}

export function modelProviderPresetSpeechCapability(
  speech: NonNullable<ModelProviderPreset['speech']>
): ModelProviderSpeechCapabilityV1 {
  return {
    protocol: speech.protocol,
    baseUrl: speech.baseUrl,
    models: [...speech.models]
  }
}

export function modelProviderPresetTextToSpeechCapability(
  textToSpeech: NonNullable<ModelProviderPreset['textToSpeech']>
): ModelProviderTextToSpeechCapabilityV1 {
  return {
    protocol: textToSpeech.protocol,
    baseUrl: textToSpeech.baseUrl,
    models: [...textToSpeech.models]
  }
}

export function modelProviderPresetMusicCapability(
  music: NonNullable<ModelProviderPreset['music'] | ModelProviderTokenPlanPreset['music']>
): ModelProviderMusicCapabilityV1 {
  return {
    protocol: music.protocol,
    baseUrl: music.baseUrl,
    models: [...music.models]
  }
}

export function modelProviderPresetVideoCapability(
  video: NonNullable<ModelProviderPreset['video'] | ModelProviderTokenPlanPreset['video']>
): ModelProviderVideoCapabilityV1 {
  return {
    protocol: video.protocol,
    baseUrl: video.baseUrl,
    models: [...video.models]
  }
}
