import type {
  ImageGenerationProtocol,
  MusicGenerationProtocol,
  ModelEndpointFormat,
  ModelProviderImageCapabilityV1,
  ModelProviderMusicCapabilityV1,
  ModelProviderModelProfileV1,
  ModelProviderProfileV1,
  ModelProviderReasoningCapabilityV1,
  ModelProviderSpeechCapabilityV1,
  ModelProviderTextToSpeechCapabilityV1,
  ModelProviderVideoCapabilityV1,
  SpeechToTextProtocol,
  TextToSpeechProtocol,
  VideoGenerationProtocol
} from './app-settings-types'

export type ModelProviderPresetId = 'litellm' | 'bigmodel' | 'zai' | 'xiaomi' | 'minimax'

export const TOKEN_PLAN_PROVIDER_ID_SUFFIX = '-token-plan'

export type ModelProviderTokenPlanRegion = {
  id: string
  baseUrl: string
}

/**
 * Subscription ("Token Plan") access mode. Providers issue separate keys for
 * subscription and pay-as-you-go calls, so this maps to its own provider
 * profile (`<presetId>-token-plan`) instead of a flag on the main profile.
 * Capabilities (speech/image) are included when subscription keys can access
 * the resource. Some resources use their own endpoint instead of the chat
 * endpoint, so each capability may carry a separate base URL.
 */
export type ModelProviderTokenPlanPreset = {
  baseUrl: string
  /** Regional clusters. When present, baseUrl must equal the first region's baseUrl. */
  regions?: ModelProviderTokenPlanRegion[]
  endpointFormat: ModelEndpointFormat
  models: string[]
  modelProfiles?: Record<string, ModelProviderModelProfileV1>
  /** Speech capability served by the plan endpoint itself (baseUrl follows the plan baseUrl). */
  speech?: {
    protocol: SpeechToTextProtocol
    models: string[]
  }
  image?: {
    protocol: ImageGenerationProtocol
    baseUrl: string
    models: string[]
  }
  textToSpeech?: {
    protocol: TextToSpeechProtocol
    baseUrl?: string
    models: string[]
  }
  music?: {
    protocol: MusicGenerationProtocol
    baseUrl: string
    models: string[]
  }
  video?: {
    protocol: VideoGenerationProtocol
    baseUrl: string
    models: string[]
  }
  /** Expected key prefix, e.g. "tp-". Hint only, never enforced. */
  keyPrefix?: string
  apiKeyUrl: string
}

export type ModelProviderPreset = {
  id: ModelProviderPresetId
  name: string
  baseUrl: string
  endpointFormat: ModelEndpointFormat
  models: string[]
  modelProfiles?: Record<string, ModelProviderModelProfileV1>
  image?: {
    protocol: ImageGenerationProtocol
    baseUrl: string
    models: string[]
  }
  speech?: {
    protocol: SpeechToTextProtocol
    baseUrl: string
    models: string[]
  }
  textToSpeech?: {
    protocol: TextToSpeechProtocol
    baseUrl: string
    models: string[]
  }
  music?: {
    protocol: MusicGenerationProtocol
    baseUrl: string
    models: string[]
  }
  video?: {
    protocol: VideoGenerationProtocol
    baseUrl: string
    models: string[]
  }
  tokenPlan?: ModelProviderTokenPlanPreset
  docsUrl: string
  apiKeyUrl: string
}

// 这些 const 必须在 MODEL_PROVIDER_PRESETS 之前声明:
// 数组初始化时就会调用下面的 profile 工厂函数,声明在后会触发 TDZ。
const XIAOMI_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['off', 'low', 'medium', 'high'],
  defaultEffort: 'high',
  requestProtocol: 'mimo-chat-completions'
}

const MINIMAX_M3_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['auto', 'off'],
  defaultEffort: 'auto',
  requestProtocol: 'anthropic-thinking'
}

const MINIMAX_BUILT_IN_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['auto'],
  defaultEffort: 'auto',
  requestProtocol: 'none'
}

const GLM_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['off', 'high', 'max'],
  defaultEffort: 'max',
  requestProtocol: 'glm-chat-completions'
}

export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  {
    id: 'litellm',
    name: 'LiteLLM',
    baseUrl: 'http://localhost:4000',
    endpointFormat: 'chat_completions',
    models: [],
    docsUrl: 'https://docs.litellm.ai/docs/',
    apiKeyUrl: 'https://docs.litellm.ai/docs/proxy/quick_start'
  },
  {
    id: 'bigmodel',
    name: 'BigModel',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    endpointFormat: 'custom_endpoint',
    models: [
      'glm-5.1',
      'glm-5',
      'glm-5-turbo',
      'glm-4.7',
      'glm-4.6',
      'glm-4.5',
      'glm-4.5-air',
      'glm-5v-turbo',
      'glm-4.6v',
      'glm-4.6v-flash',
      'glm-4.5v'
    ],
    modelProfiles: {
      'glm-5.1': glmTextChatProfile(200_000),
      'glm-5': glmTextChatProfile(200_000),
      'glm-5-turbo': glmTextChatProfile(200_000),
      'glm-4.7': glmTextChatProfile(200_000),
      'glm-4.6': glmTextChatProfile(200_000),
      'glm-4.5': glmTextChatProfile(128_000),
      'glm-4.5-air': glmTextChatProfile(128_000),
      'glm-5v-turbo': glmVisionChatProfile(200_000),
      'glm-4.6v': glmVisionChatProfile(128_000),
      'glm-4.6v-flash': glmVisionChatProfile(128_000),
      'glm-4.5v': glmVisionChatProfile(64_000)
    },
    tokenPlan: {
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
      endpointFormat: 'custom_endpoint',
      models: [
        'glm-5.2',
        'glm-5.1',
        'glm-5-turbo',
        'glm-5',
        'glm-4.7',
        'glm-4.6',
        'glm-4.6v',
        'glm-4.6v-flash',
        'glm-4.5',
        'glm-4.5-air'
      ],
      modelProfiles: {
        'glm-5.2': glmTextChatProfile(1_000_000),
        'glm-5.1': glmTextChatProfile(200_000),
        'glm-5-turbo': glmTextChatProfile(200_000),
        'glm-5': glmTextChatProfile(200_000),
        'glm-4.7': glmTextChatProfile(200_000),
        'glm-4.6': glmTextChatProfile(200_000),
        'glm-4.6v': glmVisionChatProfile(128_000),
        'glm-4.6v-flash': glmVisionChatProfile(128_000),
        'glm-4.5': glmTextChatProfile(200_000),
        'glm-4.5-air': glmTextChatProfile(200_000)
      },
      apiKeyUrl: 'https://docs.bigmodel.cn/cn/coding-plan/tool/others'
    },
    docsUrl: 'https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8',
    apiKeyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys'
  },
  {
    id: 'zai',
    name: 'Z.ai',
    baseUrl: 'https://api.z.ai/api/paas/v4/chat/completions',
    endpointFormat: 'custom_endpoint',
    models: [
      'glm-5.1',
      'glm-5',
      'glm-5-turbo',
      'glm-4.7',
      'glm-4.6',
      'glm-4.5',
      'glm-4.5-air',
      'glm-5v-turbo',
      'glm-4.6v',
      'glm-4.6v-flashx',
      'glm-4.6v-flash',
      'glm-4.5v'
    ],
    modelProfiles: {
      'glm-5.1': glmTextChatProfile(200_000),
      'glm-5': glmTextChatProfile(200_000),
      'glm-5-turbo': glmTextChatProfile(200_000),
      'glm-4.7': glmTextChatProfile(200_000),
      'glm-4.6': glmTextChatProfile(200_000),
      'glm-4.5': glmTextChatProfile(128_000),
      'glm-4.5-air': glmTextChatProfile(128_000),
      'glm-5v-turbo': glmVisionChatProfile(200_000),
      'glm-4.6v': glmVisionChatProfile(128_000),
      'glm-4.6v-flashx': glmVisionChatProfile(128_000),
      'glm-4.6v-flash': glmVisionChatProfile(128_000),
      'glm-4.5v': glmVisionChatProfile(64_000)
    },
    tokenPlan: {
      baseUrl: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
      endpointFormat: 'custom_endpoint',
      models: [
        'glm-5.2',
        'glm-5.1',
        'glm-5-turbo',
        'glm-5',
        'glm-4.7',
        'glm-4.6',
        'glm-4.6v',
        'glm-4.6v-flashx',
        'glm-4.6v-flash',
        'glm-4.5',
        'glm-4.5-air'
      ],
      modelProfiles: {
        'glm-5.2': glmTextChatProfile(1_000_000),
        'glm-5.1': glmTextChatProfile(200_000),
        'glm-5-turbo': glmTextChatProfile(200_000),
        'glm-5': glmTextChatProfile(200_000),
        'glm-4.7': glmTextChatProfile(200_000),
        'glm-4.6': glmTextChatProfile(200_000),
        'glm-4.6v': glmVisionChatProfile(128_000),
        'glm-4.6v-flashx': glmVisionChatProfile(128_000),
        'glm-4.6v-flash': glmVisionChatProfile(128_000),
        'glm-4.5': glmTextChatProfile(200_000),
        'glm-4.5-air': glmTextChatProfile(200_000)
      },
      apiKeyUrl: 'https://docs.z.ai/devpack/tool/others'
    },
    docsUrl: 'https://docs.z.ai/guides/develop/openai/python',
    apiKeyUrl: 'https://z.ai/manage-apikey/apikey-list'
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    endpointFormat: 'chat_completions',
    models: [
      'mimo-v2.5-pro-ultraspeed',
      'mimo-v2.5-pro',
      'mimo-v2.5',
      'mimo-v2-pro',
      'mimo-v2-omni',
      'mimo-v2-flash'
    ],
    modelProfiles: {
      'mimo-v2.5-pro-ultraspeed': xiaomiTextChatProfile(1_000_000),
      'mimo-v2.5-pro': xiaomiTextChatProfile(1_000_000),
      'mimo-v2.5': xiaomiVisionChatProfile(1_000_000),
      'mimo-v2-pro': xiaomiTextChatProfile(1_000_000),
      'mimo-v2-omni': xiaomiVisionChatProfile(256_000),
      'mimo-v2-flash': xiaomiTextChatProfile(256_000)
    },
    speech: {
      protocol: 'mimo-asr',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      models: ['mimo-v2.5-asr']
    },
    textToSpeech: {
      protocol: 'mimo-tts',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      models: ['mimo-v2.5-tts', 'mimo-v2.5-tts-voicedesign', 'mimo-v2.5-tts-voiceclone']
    },
    tokenPlan: {
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      regions: [
        { id: 'cn', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' },
        { id: 'sgp', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1' },
        { id: 'ams', baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1' }
      ],
      endpointFormat: 'chat_completions',
      models: [
        'mimo-v2.5-pro-ultraspeed',
        'mimo-v2.5-pro',
        'mimo-v2.5',
        'mimo-v2-pro',
        'mimo-v2-omni',
        'mimo-v2-flash'
      ],
      modelProfiles: {
        'mimo-v2.5-pro-ultraspeed': xiaomiTextChatProfile(1_000_000),
        'mimo-v2.5-pro': xiaomiTextChatProfile(1_000_000),
        'mimo-v2.5': xiaomiVisionChatProfile(1_000_000),
        'mimo-v2-pro': xiaomiTextChatProfile(1_000_000),
        'mimo-v2-omni': xiaomiVisionChatProfile(256_000),
        'mimo-v2-flash': xiaomiTextChatProfile(256_000)
      },
      speech: {
        protocol: 'mimo-asr',
        models: ['mimo-v2.5-asr']
      },
      textToSpeech: {
        protocol: 'mimo-tts',
        models: ['mimo-v2.5-tts', 'mimo-v2.5-tts-voicedesign', 'mimo-v2.5-tts-voiceclone']
      },
      keyPrefix: 'tp-',
      apiKeyUrl: 'https://platform.xiaomimimo.com/docs/en-US/price/tokenplan/quick-access'
    },
    docsUrl: 'https://platform.xiaomimimo.com/#/docs',
    apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys'
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    endpointFormat: 'messages',
    models: [
      'MiniMax-M3',
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.1',
      'MiniMax-M2.1-highspeed',
      'MiniMax-M2'
    ],
    modelProfiles: {
      'MiniMax-M3': minimaxM3ChatProfile(),
      'MiniMax-M2.7': minimaxM2ChatProfile(),
      'MiniMax-M2.7-highspeed': minimaxM2ChatProfile(),
      'MiniMax-M2.5': minimaxM2ChatProfile(),
      'MiniMax-M2.5-highspeed': minimaxM2ChatProfile(),
      'MiniMax-M2.1': minimaxM2ChatProfile(),
      'MiniMax-M2.1-highspeed': minimaxM2ChatProfile(),
      'MiniMax-M2': minimaxM2ChatProfile()
    },
    image: {
      protocol: 'minimax-image',
      baseUrl: 'https://api.minimaxi.com',
      models: ['image-01', 'image-01-live']
    },
    textToSpeech: {
      protocol: 'minimax-t2a',
      baseUrl: 'https://api.minimax.io',
      models: ['speech-2.8-hd', 'speech-2.8-turbo']
    },
    music: {
      protocol: 'minimax-music',
      baseUrl: 'https://api.minimax.io',
      models: ['music-2.6', 'music-cover', 'music-2.6-free', 'music-cover-free']
    },
    video: {
      protocol: 'minimax-video',
      baseUrl: 'https://api.minimax.io',
      models: ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast']
    },
    tokenPlan: {
      baseUrl: 'https://api.minimaxi.com/anthropic',
      regions: [
        { id: 'cn', baseUrl: 'https://api.minimaxi.com/anthropic' },
        { id: 'global', baseUrl: 'https://api.minimax.io/anthropic' }
      ],
      endpointFormat: 'messages',
      models: [
        'MiniMax-M3',
        'MiniMax-M2.7',
        'MiniMax-M2.7-highspeed',
        'MiniMax-M2.5',
        'MiniMax-M2.5-highspeed',
        'MiniMax-M2.1',
        'MiniMax-M2.1-highspeed',
        'MiniMax-M2'
      ],
      modelProfiles: {
        'MiniMax-M3': minimaxM3ChatProfile(),
        'MiniMax-M2.7': minimaxM2ChatProfile(),
        'MiniMax-M2.7-highspeed': minimaxM2ChatProfile(),
        'MiniMax-M2.5': minimaxM2ChatProfile(),
        'MiniMax-M2.5-highspeed': minimaxM2ChatProfile(),
        'MiniMax-M2.1': minimaxM2ChatProfile(),
        'MiniMax-M2.1-highspeed': minimaxM2ChatProfile(),
        'MiniMax-M2': minimaxM2ChatProfile()
      },
      image: {
        protocol: 'minimax-image',
        baseUrl: 'https://api.minimaxi.com',
        models: ['image-01', 'image-01-live']
      },
      textToSpeech: {
        protocol: 'minimax-t2a',
        baseUrl: 'https://api.minimax.io',
        models: ['speech-2.8-hd', 'speech-2.8-turbo']
      },
      music: {
        protocol: 'minimax-music',
        baseUrl: 'https://api.minimax.io',
        models: ['music-2.6', 'music-cover', 'music-2.6-free', 'music-cover-free']
      },
      video: {
        protocol: 'minimax-video',
        baseUrl: 'https://api.minimax.io',
        models: ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast']
      },
      apiKeyUrl: 'https://platform.minimaxi.com/docs/token-plan/quickstart'
    },
    docsUrl: 'https://platform.minimax.io/docs/api-reference/text-anthropic-api',
    apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key'
  }
]

export function getModelProviderPreset(id: string): ModelProviderPreset | null {
  return MODEL_PROVIDER_PRESETS.find((preset) => preset.id === id) ?? null
}

export function modelProviderPresetProfile(
  preset: ModelProviderPreset,
  apiKey = ''
): ModelProviderProfileV1 {
  return {
    id: preset.id,
    name: preset.name,
    apiKey: apiKey.trim(),
    baseUrl: preset.baseUrl,
    endpointFormat: preset.endpointFormat,
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
    name: `${preset.name} Token Plan`,
    apiKey: apiKey.trim(),
    baseUrl: resolvedBaseUrl,
    endpointFormat: tokenPlan.endpointFormat,
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

function tokenPlanCapabilityBaseUrl(
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

function urlOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null
  try {
    return new URL(value.trim()).origin
  } catch {
    return null
  }
}

function replaceUrlOrigin(value: string, origin: string): string {
  try {
    const url = new URL(value.trim())
    const path = url.pathname.replace(/\/+$/, '')
    return `${origin}${path === '/' ? '' : path}${url.search}`
  } catch {
    return value.trim()
  }
}

function xiaomiTextChatProfile(contextWindowTokens: number): ModelProviderModelProfileV1 {
  return textChatProfile(contextWindowTokens, XIAOMI_REASONING)
}

function xiaomiVisionChatProfile(contextWindowTokens: number): ModelProviderModelProfileV1 {
  return visionChatProfile(contextWindowTokens, XIAOMI_REASONING)
}

function minimaxM3ChatProfile(): ModelProviderModelProfileV1 {
  return visionChatProfile(1_000_000, MINIMAX_M3_REASONING)
}

function minimaxM2ChatProfile(): ModelProviderModelProfileV1 {
  return textChatProfile(204_800, MINIMAX_BUILT_IN_REASONING)
}

function glmTextChatProfile(contextWindowTokens: number): ModelProviderModelProfileV1 {
  return textChatProfile(contextWindowTokens, GLM_REASONING)
}

function glmVisionChatProfile(contextWindowTokens: number): ModelProviderModelProfileV1 {
  return visionChatProfile(contextWindowTokens, GLM_REASONING)
}

function textChatProfile(
  contextWindowTokens: number,
  reasoning?: ModelProviderReasoningCapabilityV1
): ModelProviderModelProfileV1 {
  return {
    contextWindowTokens,
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text'],
    ...(reasoning ? { reasoning } : {})
  }
}

function visionChatProfile(
  contextWindowTokens: number,
  reasoning?: ModelProviderReasoningCapabilityV1
): ModelProviderModelProfileV1 {
  return {
    contextWindowTokens,
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text', 'image_url'],
    ...(reasoning ? { reasoning } : {})
  }
}

function copyModelProfiles(
  profiles: Record<string, ModelProviderModelProfileV1> | undefined
): Record<string, ModelProviderModelProfileV1> {
  if (!profiles) return {}
  return Object.fromEntries(
    Object.entries(profiles).map(([modelId, profile]) => [
      modelId,
      {
        ...profile,
        ...(profile.aliases ? { aliases: [...profile.aliases] } : {}),
        inputModalities: [...profile.inputModalities],
        outputModalities: [...profile.outputModalities],
        messageParts: [...profile.messageParts],
        ...(profile.reasoning
          ? {
              reasoning: {
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

function modelProviderPresetImageCapability(
  image: NonNullable<ModelProviderPreset['image']>
): ModelProviderImageCapabilityV1 {
  return {
    protocol: image.protocol,
    baseUrl: image.baseUrl,
    models: [...image.models]
  }
}

function modelProviderPresetSpeechCapability(
  speech: NonNullable<ModelProviderPreset['speech']>
): ModelProviderSpeechCapabilityV1 {
  return {
    protocol: speech.protocol,
    baseUrl: speech.baseUrl,
    models: [...speech.models]
  }
}

function modelProviderPresetTextToSpeechCapability(
  textToSpeech: NonNullable<ModelProviderPreset['textToSpeech']>
): ModelProviderTextToSpeechCapabilityV1 {
  return {
    protocol: textToSpeech.protocol,
    baseUrl: textToSpeech.baseUrl,
    models: [...textToSpeech.models]
  }
}

function modelProviderPresetMusicCapability(
  music: NonNullable<ModelProviderPreset['music'] | ModelProviderTokenPlanPreset['music']>
): ModelProviderMusicCapabilityV1 {
  return {
    protocol: music.protocol,
    baseUrl: music.baseUrl,
    models: [...music.models]
  }
}

function modelProviderPresetVideoCapability(
  video: NonNullable<ModelProviderPreset['video'] | ModelProviderTokenPlanPreset['video']>
): ModelProviderVideoCapabilityV1 {
  return {
    protocol: video.protocol,
    baseUrl: video.baseUrl,
    models: [...video.models]
  }
}
