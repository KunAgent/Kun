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

export type ModelProviderPresetId =
  | 'litellm'
  | 'longcat'
  | 'zhipu-coding-plan'
  | 'zai-coding-plan'
  | 'kimi-code'
  | 'volcengine-coding-plan'
  | 'opencode-go'
  | 'moonshot-cn'
  | 'moonshot-global'
  | 'xiaomi'
  | 'minimax'
  | 'aliyun'
  | 'tencentcloud'
  | 'vercel-ai-gateway'

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
  /**
   * 计费/接入大类。'subscription' = 固定费用套餐(Coding Plan、Token Plan 这类),
   * 'api'(默认) = 按量付费。仅用于设置页把套餐类供应商收拢成一组,不写入存储的 profile。
   */
  category?: 'api' | 'subscription'
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

// 通义千问 / 混元 / 豆包的「思考」开关各家用私有 body 字段,无法用现有 requestProtocol 精确映射,
// 这里统一按「内置推理」建模(requestProtocol: 'none'):只展示 effort 开关、不向上游发送特定协议字段,避免请求被拒。
const QWEN_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['auto', 'off'],
  defaultEffort: 'auto',
  requestProtocol: 'none'
}

const HUNYUAN_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['auto', 'off'],
  defaultEffort: 'auto',
  requestProtocol: 'none'
}

const DOUBAO_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['auto', 'off'],
  defaultEffort: 'auto',
  requestProtocol: 'none'
}

const ZHIPU_CODING_PLAN_MODELS = [
  'glm-5.2',
  'glm-5.1',
  'glm-5-turbo',
  'glm-4.7',
  'glm-4.5-air'
]

const ZAI_CODING_PLAN_MODELS = [
  'glm-5.2',
  'glm-5.1',
  'glm-5',
  'glm-5-turbo',
  'glm-4.7',
  'glm-4.5-air'
]

const MOONSHOT_CHAT_MODELS = [
  'kimi-k2.7-code',
  'kimi-k2.6',
  'kimi-k2.5',
  'moonshot-v1-128k',
  'moonshot-v1-32k',
  'moonshot-v1-8k'
]

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
    id: 'longcat',
    name: 'LongCat',
    baseUrl: 'https://api.longcat.chat/openai',
    endpointFormat: 'chat_completions',
    models: ['LongCat-2.0-Preview'],
    modelProfiles: {
      'LongCat-2.0-Preview': textChatProfile(1_000_000)
    },
    docsUrl: 'https://longcat.chat/platform/docs/zh/',
    apiKeyUrl: 'https://longcat.chat/platform/'
  },
  {
    id: 'zhipu-coding-plan',
    name: 'Zhipu Coding Plan',
    category: 'subscription',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
    endpointFormat: 'custom_endpoint',
    models: [...ZHIPU_CODING_PLAN_MODELS],
    modelProfiles: {
      'glm-5.2': textChatProfile(1_000_000, GLM_REASONING),
      'glm-5.1': textChatProfile(200_000, GLM_REASONING),
      'glm-5-turbo': textChatProfile(200_000, GLM_REASONING),
      'glm-4.7': textChatProfile(200_000, GLM_REASONING),
      'glm-4.5-air': textChatProfile(200_000, GLM_REASONING)
    },
    docsUrl: 'https://docs.bigmodel.cn/cn/coding-plan/overview',
    apiKeyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys'
  },
  {
    id: 'zai-coding-plan',
    name: 'Z.ai Coding Plan',
    category: 'subscription',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
    endpointFormat: 'custom_endpoint',
    models: [...ZAI_CODING_PLAN_MODELS],
    modelProfiles: {
      'glm-5.2': textChatProfile(1_000_000, GLM_REASONING),
      'glm-5.1': textChatProfile(200_000, GLM_REASONING),
      'glm-5': textChatProfile(200_000, GLM_REASONING),
      'glm-5-turbo': textChatProfile(200_000, GLM_REASONING),
      'glm-4.7': textChatProfile(200_000, GLM_REASONING),
      'glm-4.5-air': textChatProfile(200_000, GLM_REASONING)
    },
    docsUrl: 'https://docs.z.ai/devpack/tool/others',
    apiKeyUrl: 'https://z.ai/subscribe'
  },
  {
    id: 'kimi-code',
    name: 'Kimi Code',
    category: 'subscription',
    baseUrl: 'https://api.kimi.com/coding/v1',
    endpointFormat: 'chat_completions',
    models: ['kimi-for-coding'],
    modelProfiles: {
      'kimi-for-coding': textChatProfile()
    },
    docsUrl: 'https://www.kimi.com/code/docs/en/',
    apiKeyUrl: 'https://www.kimi.com/code'
  },
  {
    id: 'volcengine-coding-plan',
    name: 'Volcano Ark Coding Plan',
    category: 'subscription',
    // 火山方舟 Coding Plan 与按量付费共用同一个 API Key,但套餐额度只在 /api/coding 网关上消费;
    // 用按量 base(/api/v3)调用会按量计费。官方注明套餐额度仅限编程工具(Claude Code / Cursor 等)使用。
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    endpointFormat: 'chat_completions',
    models: ['doubao-seed-1-6-250615', 'doubao-seed-1-6-flash-250828'],
    modelProfiles: {
      'doubao-seed-1-6-250615': visionChatProfile(256_000, DOUBAO_REASONING),
      'doubao-seed-1-6-flash-250828': textChatProfile(256_000, DOUBAO_REASONING)
    },
    docsUrl: 'https://www.volcengine.com/docs/82379/1928262',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey'
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    category: 'subscription',
    // 网关默认走 chat_completions;MiniMax / Qwen 系列在 OpenCode Go 上以
    // Anthropic Messages 格式提供,故按模型用 endpointFormat:'messages' 覆盖
    // (请求改打 …/zen/go/v1/messages)。
    baseUrl: 'https://opencode.ai/zen/go/v1',
    endpointFormat: 'chat_completions',
    models: [
      'glm-5.1',
      'glm-5',
      'kimi-k2.7',
      'kimi-k2.7-code',
      'kimi-k2.6',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'mimo-v2.5',
      'mimo-v2.5-pro',
      'mimo-v2-pro',
      'mimo-v2-omni',
      'minimax-m3',
      'minimax-m2.7',
      'minimax-m2.5',
      'qwen3.7-max',
      'qwen3.7-plus',
      'qwen3.6-plus',
      'qwen3.5-plus'
    ],
    modelProfiles: {
      'glm-5.1': visionChatProfile(131_072),
      'glm-5': visionChatProfile(131_072),
      'kimi-k2.7': textChatProfile(131_072),
      'kimi-k2.7-code': textChatProfile(131_072),
      'kimi-k2.6': textChatProfile(131_072),
      'deepseek-v4-pro': textChatProfile(131_072),
      'deepseek-v4-flash': textChatProfile(131_072),
      'mimo-v2.5': textChatProfile(131_072),
      'mimo-v2.5-pro': textChatProfile(131_072),
      'mimo-v2-pro': textChatProfile(131_072),
      'mimo-v2-omni': visionChatProfile(131_072),
      'minimax-m3': textChatProfile(256_000, undefined, 'messages'),
      'minimax-m2.7': textChatProfile(256_000, undefined, 'messages'),
      'minimax-m2.5': textChatProfile(256_000, undefined, 'messages'),
      'qwen3.7-max': textChatProfile(262_144, undefined, 'messages'),
      'qwen3.7-plus': textChatProfile(262_144, undefined, 'messages'),
      'qwen3.6-plus': textChatProfile(262_144, undefined, 'messages'),
      'qwen3.5-plus': textChatProfile(262_144, undefined, 'messages')
    },
    docsUrl: 'https://opencode.ai/docs/go/',
    apiKeyUrl: 'https://opencode.ai/auth'
  },
  {
    id: 'moonshot-cn',
    name: 'Moonshot CN',
    baseUrl: 'https://api.moonshot.cn/v1',
    endpointFormat: 'chat_completions',
    models: [...MOONSHOT_CHAT_MODELS],
    modelProfiles: {
      'kimi-k2.7-code': visionChatProfile(),
      'kimi-k2.6': visionChatProfile(),
      'kimi-k2.5': visionChatProfile(),
      'moonshot-v1-128k': textChatProfile(128_000),
      'moonshot-v1-32k': textChatProfile(32_000),
      'moonshot-v1-8k': textChatProfile(8_000)
    },
    docsUrl: 'https://platform.moonshot.cn/docs',
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys'
  },
  {
    id: 'moonshot-global',
    name: 'Moonshot Global',
    baseUrl: 'https://api.moonshot.ai/v1',
    endpointFormat: 'chat_completions',
    models: [...MOONSHOT_CHAT_MODELS],
    modelProfiles: {
      'kimi-k2.7-code': visionChatProfile(),
      'kimi-k2.6': visionChatProfile(),
      'kimi-k2.5': visionChatProfile(),
      'moonshot-v1-128k': textChatProfile(128_000),
      'moonshot-v1-32k': textChatProfile(32_000),
      'moonshot-v1-8k': textChatProfile(8_000)
    },
    docsUrl: 'https://platform.moonshot.ai/docs',
    apiKeyUrl: 'https://platform.moonshot.ai/console/api-keys'
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
      'mimo-v2-omni'
    ],
    modelProfiles: {
      'mimo-v2.5-pro-ultraspeed': xiaomiTextChatProfile(1_000_000),
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
        'mimo-v2.5-pro-ultraspeed',
        'mimo-v2.5-pro',
        'mimo-v2.5',
        'mimo-v2-pro',
        'mimo-v2-omni'
      ],
      modelProfiles: {
        'mimo-v2.5-pro-ultraspeed': xiaomiTextChatProfile(1_000_000),
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
    id: 'vercel-ai-gateway',
    name: 'Vercel AI Gateway',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    endpointFormat: 'chat_completions',
    models: [],
    docsUrl: 'https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions',
    apiKeyUrl: 'https://vercel.com/ai-gateway'
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

function textChatProfile(
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

function visionChatProfile(
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
