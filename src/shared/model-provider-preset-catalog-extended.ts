import {
  codexLiteVisionChatProfile,
  minimaxM2ChatProfile,
  minimaxM3ChatProfile,
  textChatProfile,
  visionChatProfile,
  withPriorityServiceTier,
  xiaomiTextChatProfile,
  xiaomiVisionChatProfile
} from './model-provider-preset-profile-builders'
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
  CHATGPT_SUBSCRIPTION_MODEL_IDS,
  CHATGPT_SUBSCRIPTION_NAME,
  CHATGPT_SUBSCRIPTION_PROVIDER_ID,
  CODEX_RESPONSES_REASONING,
  GROK_RESPONSES_REASONING,
  GROK_SUBSCRIPTION_MODEL_IDS,
  GROK_SUBSCRIPTION_NAME,
  GROK_SUBSCRIPTION_PROVIDER_ID,
  HUNYUAN_REASONING,
  ModelProviderPreset,
  QWEN_REASONING,
  STEPFUN_REASONING
} from './model-provider-preset-types'

export const MODEL_PROVIDER_PRESETS_EXTENDED: ModelProviderPreset[] = [
{
    id: 'xiaomi',
    name: 'Xiaomi',
    subscriptionRegion: 'china',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    endpointFormat: 'chat_completions',
    models: [
      'mimo-v2.5-pro',
      'mimo-v2.5',
      'mimo-v2-pro',
      'mimo-v2-omni'
    ],
    modelProfiles: {
      'mimo-v2.5-pro': xiaomiTextChatProfile(1_000_000),
      'mimo-v2.5': xiaomiVisionChatProfile(1_000_000),
      'mimo-v2-pro': xiaomiTextChatProfile(1_000_000),
      'mimo-v2-omni': xiaomiVisionChatProfile(256_000)
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
        'mimo-v2.5-pro',
        'mimo-v2.5',
        'mimo-v2-pro',
        'mimo-v2-omni'
      ],
      modelProfiles: {
        'mimo-v2.5-pro': xiaomiTextChatProfile(1_000_000),
        'mimo-v2.5': xiaomiVisionChatProfile(1_000_000),
        'mimo-v2-pro': xiaomiTextChatProfile(1_000_000),
        'mimo-v2-omni': xiaomiVisionChatProfile(256_000)
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
    subscriptionRegion: 'china',
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
  },
{
    id: 'aliyun',
    name: 'Aliyun',
    subscriptionRegion: 'china',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    endpointFormat: 'chat_completions',
    models: [
      'qwen-max',
      'qwen-plus',
      'qwen-flash',
      'qwen3-coder-plus',
      'qwq-plus',
      'qwen-vl-max',
      'qwen3-vl-plus'
    ],
    modelProfiles: {
      'qwen-max': textChatProfile(262_144),
      'qwen-plus': textChatProfile(1_000_000),
      'qwen-flash': textChatProfile(1_000_000),
      'qwen3-coder-plus': textChatProfile(1_000_000),
      'qwq-plus': textChatProfile(131_072, QWEN_REASONING),
      'qwen-vl-max': visionChatProfile(131_072),
      'qwen3-vl-plus': visionChatProfile(262_144, QWEN_REASONING)
    },
    tokenPlan: {
      // 通义千问 Token Plan(团队版):独立 Key + 独立 base URL,与按量 sk- Key 不互通。
      baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      regions: [
        { id: 'cn', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' },
        { id: 'sgp', baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1' }
      ],
      endpointFormat: 'chat_completions',
      models: [
        'qwen-max',
        'qwen-plus',
        'qwen-flash',
        'qwen3-coder-plus',
        'qwq-plus',
        'qwen-vl-max',
        'qwen3-vl-plus'
      ],
      modelProfiles: {
        'qwen-max': textChatProfile(262_144),
        'qwen-plus': textChatProfile(1_000_000),
        'qwen-flash': textChatProfile(1_000_000),
        'qwen3-coder-plus': textChatProfile(1_000_000),
        'qwq-plus': textChatProfile(131_072, QWEN_REASONING),
        'qwen-vl-max': visionChatProfile(131_072),
        'qwen3-vl-plus': visionChatProfile(262_144, QWEN_REASONING)
      },
      apiKeyUrl: 'https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key'
    },
    docsUrl: 'https://help.aliyun.com/zh/model-studio/',
    apiKeyUrl: 'https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key'
  },
{
    id: 'tencentcloud',
    name: 'Tencent Cloud',
    subscriptionRegion: 'china',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    endpointFormat: 'chat_completions',
    models: ['hunyuan-turbos-latest', 'hunyuan-t1-latest', 'hunyuan-lite'],
    modelProfiles: {
      'hunyuan-turbos-latest': textChatProfile(32_768),
      'hunyuan-t1-latest': textChatProfile(32_768, HUNYUAN_REASONING),
      'hunyuan-lite': textChatProfile(256_000)
    },
    tokenPlan: {
      // 腾讯混元 Token Plan(TokenHub):独立 sk-tp- Key + 独立 base URL,与按量 sk- Key 不互通。
      baseUrl: 'https://api.lkeap.cloud.tencent.com/plan/v3',
      endpointFormat: 'chat_completions',
      models: ['hunyuan-turbos-latest', 'hunyuan-t1-latest', 'hunyuan-lite'],
      modelProfiles: {
        'hunyuan-turbos-latest': textChatProfile(32_768),
        'hunyuan-t1-latest': textChatProfile(32_768, HUNYUAN_REASONING),
        'hunyuan-lite': textChatProfile(256_000)
      },
      keyPrefix: 'sk-tp-',
      apiKeyUrl: 'https://console.cloud.tencent.com/tokenhub/tokenplan'
    },
    docsUrl: 'https://cloud.tencent.com/document/product/1729/111006',
    apiKeyUrl: 'https://console.cloud.tencent.com/hunyuan/start'
  },
{
    id: CHATGPT_SUBSCRIPTION_PROVIDER_ID,
    name: CHATGPT_SUBSCRIPTION_NAME,
    category: 'subscription',
    subscriptionRegion: 'united-states',
    baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
    endpointFormat: 'custom_endpoint',
    models: [...CHATGPT_SUBSCRIPTION_MODEL_IDS],
    modelProfiles: {
      'gpt-5.5': withPriorityServiceTier(
        visionChatProfile(1_000_000, CODEX_RESPONSES_REASONING)
      ),
      'gpt-5.6-sol': withPriorityServiceTier(codexLiteVisionChatProfile(372_000)),
      'gpt-5.6-terra': withPriorityServiceTier(codexLiteVisionChatProfile(372_000)),
      'gpt-5.6-luna': withPriorityServiceTier(codexLiteVisionChatProfile(372_000)),
      'gpt-5.4': withPriorityServiceTier(
        visionChatProfile(1_000_000, CODEX_RESPONSES_REASONING)
      ),
      'gpt-5.4-mini': visionChatProfile(1_000_000, CODEX_RESPONSES_REASONING),
      'gpt-5.3-codex-spark': textChatProfile(128_000, CODEX_RESPONSES_REASONING)
    },
    image: {
      protocol: 'codex-responses-image',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      models: ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini']
    },
    docsUrl: 'https://openai.com/index/codex/',
    apiKeyUrl: 'https://chatgpt.com'
  },
{
    id: GROK_SUBSCRIPTION_PROVIDER_ID,
    name: GROK_SUBSCRIPTION_NAME,
    category: 'subscription',
    subscriptionRegion: 'united-states',
    // Session OAuth tokens must hit cli-chat-proxy (subscription quota). Pay-as-you-go
    // XAI_API_KEY traffic uses https://api.x.ai/v1 instead — keep them separate.
    baseUrl: 'https://cli-chat-proxy.grok.com/v1',
    endpointFormat: 'responses',
    models: [...GROK_SUBSCRIPTION_MODEL_IDS],
    modelProfiles: {
      'grok-4.5': visionChatProfile(500_000, GROK_RESPONSES_REASONING),
      'grok-4-1-fast-reasoning': visionChatProfile(2_000_000),
      'grok-4-1-fast-non-reasoning': visionChatProfile(2_000_000),
      'grok-code-fast-1': textChatProfile(256_000)
    },
    // Grok Build deliberately sends subscription OAuth bearers directly to the
    // public xAI media API. Chat remains on cli-chat-proxy above.
    image: {
      protocol: 'grok-imagine-image',
      baseUrl: 'https://api.x.ai/v1',
      models: ['grok-imagine-image-quality', 'grok-imagine-image']
    },
    video: {
      protocol: 'grok-imagine-video',
      baseUrl: 'https://api.x.ai/v1',
      models: ['grok-imagine-video-1.5-preview', 'grok-imagine-video']
    },
    speech: {
      protocol: 'xai-stt',
      baseUrl: 'https://api.x.ai/v1',
      models: ['grok-transcribe']
    },
    docsUrl: 'https://docs.x.ai/',
    apiKeyUrl: 'https://accounts.x.ai'
  },
{
    id: 'vercel-ai-gateway',
    name: 'Vercel AI Gateway',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    endpointFormat: 'chat_completions',
    models: [],
    docsUrl: 'https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions',
    apiKeyUrl: 'https://vercel.com/ai-gateway'
  },
{
    id: 'stepfun',
    name: 'StepFun',
    subscriptionRegion: 'china',
    baseUrl: 'https://api.stepfun.ai/v1',
    endpointFormat: 'chat_completions',
    models: ['step-3.7-flash', 'step-3.5-flash'],
    modelProfiles: {
      'step-3.7-flash': visionChatProfile(262_144, STEPFUN_REASONING),
      'step-3.5-flash': textChatProfile(262_144)
    },
    tokenPlan: {
      displayName: 'Step Plan',
      baseUrl: 'https://api.stepfun.ai/step_plan/v1',
      endpointFormat: 'chat_completions',
      models: ['step-5-preview', 'step-3.7-flash', 'step-3.5-flash', 'step-3.5-flash-2603'],
      modelProfiles: {
        'step-5-preview': visionChatProfile(1_000_000),
        'step-3.7-flash': visionChatProfile(262_144, STEPFUN_REASONING),
        'step-3.5-flash': textChatProfile(262_144),
        'step-3.5-flash-2603': textChatProfile(262_144)
      },
      apiKeyUrl: 'https://platform.stepfun.ai/interface-key'
    },
    docsUrl: 'https://platform.stepfun.ai/docs',
    apiKeyUrl: 'https://platform.stepfun.ai/interface-key'
  }
]
