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

export type ModelProviderPresetId =
  | 'litellm'
  | 'longcat'
  | 'zhipu-coding-plan'
  | 'zai-coding-plan'
  | 'kimi-code'
  | 'volcengine'
  | 'volcengine-agent-plan'
  | 'volcengine-coding-plan'
  | 'opencode-go'
  | 'opencode-free'
  | 'zenmux'
  | 'codex'
  | 'claude-subscription'
  | 'gemini-subscription'
  | 'gemini-cli-subscription'
  | 'cursor-subscription'
  | 'ollama'
  | 'grok-subscription'
  | 'moonshot-cn'
  | 'moonshot-global'
  | 'xiaomi'
  | 'minimax'
  | 'aliyun'
  | 'tencentcloud'
  | 'vercel-ai-gateway'

export const TOKEN_PLAN_PROVIDER_ID_SUFFIX = '-token-plan'

export const CHATGPT_SUBSCRIPTION_PROVIDER_ID = 'codex'

export const CHATGPT_SUBSCRIPTION_LEGACY_NAME = 'Codex (ChatGPT)'

export const CHATGPT_SUBSCRIPTION_NAME = 'ChatGPT 订阅'

export const GROK_SUBSCRIPTION_PROVIDER_ID = 'grok-subscription'

export const GROK_SUBSCRIPTION_NAME = 'Grok 订阅'

export const GEMINI_SUBSCRIPTION_PROVIDER_ID = 'gemini-subscription'

export const GEMINI_SUBSCRIPTION_NAME = 'Google Antigravity 订阅'

export const GEMINI_CLI_SUBSCRIPTION_PROVIDER_ID = 'gemini-cli-subscription'

export const GEMINI_CLI_SUBSCRIPTION_NAME = 'Gemini CLI 订阅（API）'

export const CURSOR_SUBSCRIPTION_PROVIDER_ID = 'cursor-subscription'

export const CURSOR_SUBSCRIPTION_NAME = 'Cursor 订阅'

export const CURSOR_SUBSCRIPTION_MODEL_IDS = ['auto'] as const

export const OLLAMA_CLOUD_PROVIDER_ID = 'ollama'

export const OLLAMA_CLOUD_PROVIDER_NAME = 'Ollama Cloud'

export const OPENCODE_FREE_PROVIDER_ID = 'opencode-free'

export const OPENCODE_FREE_PROVIDER_NAME = 'OpenCore Free'

// Bootstrap snapshot of the non-deprecated zero-cost models that OpenCode Zen
// serves anonymously through Chat Completions. Settings may import newer
// zero-cost models from models.dev, but a mixed endpoint family must not be
// seeded into this single-protocol provider.
export const OPENCODE_FREE_MODEL_IDS = [
  'big-pickle',
  'mimo-v2.5-free',
  'ling-3.0-flash-fin-free',
  'nemotron-3-ultra-free',
  'nemotron-3.5-lightning-free'
] as const

// Bootstrap snapshot from Ollama Cloud's official GET /v1/models response.
// The live endpoint remains authoritative and Settings can import additions.
export const OLLAMA_CLOUD_MODEL_IDS = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'gemma4:31b',
  'glm-5.1',
  'glm-5.2',
  'gpt-oss:120b',
  'gpt-oss:20b',
  'kimi-k2.5',
  'kimi-k2.6',
  'kimi-k2.7-code',
  'minimax-m2.5',
  'minimax-m2.7',
  'minimax-m3',
  'mistral-large-3:675b',
  'nemotron-3-nano:30b',
  'nemotron-3-super',
  'nemotron-3-ultra',
  'qwen3.5:397b'
] as const

export const GEMINI_SUBSCRIPTION_MODEL_IDS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-pro'
] as const

// Concrete model ids accepted by the official Gemini CLI Code Assist API
// path. Keep this catalog independent from Antigravity's `agy models` output:
// the two transports can expose different releases to the same Google account.
// The catalog is a bootstrap, not the source of truth: users can add newer
// releases (e.g. a future `gemini-3.7-*`) via the model editor and the sync
// flow preserves those ids instead of truncating them back to this list.
export const GEMINI_CLI_SUBSCRIPTION_MODEL_IDS = [
  'gemini-3.7-pro-preview',
  'gemini-3.7-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.5-flash'
] as const

export const GROK_SUBSCRIPTION_MODEL_IDS = [
  'grok-4.5',
  'grok-4-1-fast-reasoning',
  'grok-4-1-fast-non-reasoning',
  'grok-code-fast-1'
] as const

export const CHATGPT_SUBSCRIPTION_LEGACY_MODEL_IDS = [
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex-spark'
] as const

export const CHATGPT_SUBSCRIPTION_MODEL_IDS = [
  'gpt-5.5',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex-spark'
] as const

export type ModelProviderTokenPlanRegion = {
  id: string
  baseUrl: string
}

export type ModelProviderSubscriptionRegion = 'china' | 'united-states'

/**
 * Subscription ("Token Plan") access mode. Providers issue separate keys for
 * subscription and pay-as-you-go calls, so this maps to its own provider
 * profile (`<presetId>-token-plan`) instead of a flag on the main profile.
 * Capabilities (speech/image) are included when subscription keys can access
 * the resource. Some resources use their own endpoint instead of the chat
 * endpoint, so each capability may carry a separate base URL.
 */
export type ModelProviderTokenPlanPreset = {
  /** Optional product-specific name used instead of the generic "Token Plan" label. */
  displayName?: string
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
   * 'free' = 内置免 Key 供应商，'subscription' = 固定费用套餐，
   * 'api'(默认) = 按量付费。仅用于设置页分组，不写入存储的 profile。
   */
  category?: 'api' | 'free' | 'subscription'
  /**
   * 套餐订阅筛选所使用的供应商归属地区。仅用于预设选择器展示，不写入 provider profile。
   * 同一个预设的 Token Plan 入口沿用这里的地区。
   */
  subscriptionRegion?: ModelProviderSubscriptionRegion
  /**
   * 传输类型。'agent-sdk' = 把整轮委托给内置的官方 Claude Agent SDK(消耗 Claude
   * Pro/Max 订阅额度,合规路径);'antigravity-cli' = 把整轮委托给 Google 官方
   * Antigravity CLI(使用 Gemini 订阅);'gemini-cli-api' = 复用官方 Gemini CLI
   * OAuth 登录并直接调用 Code Assist API,由 Kun 保留 agent loop;'cursor-sdk' =
   * 使用 Cursor API Key 把整轮委托给官方 Cursor SDK;缺省按 HTTP 模型客户端走 baseUrl。
   */
  kind?: 'agent-sdk' | 'antigravity-cli' | 'gemini-cli-api' | 'cursor-sdk'
  /** Overrides the default retry count for this preset's API profile. */
  defaultRetryMaxAttempts?: number
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
export const XIAOMI_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['off', 'low', 'medium', 'high'],
  defaultEffort: 'high',
  requestProtocol: 'mimo-chat-completions'
}

export const MINIMAX_M3_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['auto', 'off'],
  defaultEffort: 'auto',
  requestProtocol: 'anthropic-thinking'
}

export const MINIMAX_BUILT_IN_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['auto'],
  defaultEffort: 'auto',
  requestProtocol: 'none'
}

export const GLM_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['off', 'high', 'max'],
  defaultEffort: 'max',
  requestProtocol: 'glm-chat-completions'
}

export const CODEX_RESPONSES_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['low', 'medium', 'high', 'max'],
  defaultEffort: 'high',
  requestProtocol: 'openai-responses'
}

export const GROK_RESPONSES_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['low', 'medium', 'high'],
  defaultEffort: 'high',
  requestProtocol: 'openai-responses'
}

export const GROK_CHAT_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['low', 'medium', 'high'],
  defaultEffort: 'medium',
  requestProtocol: 'openai-chat-completions'
}

export const KIMI_K3_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['low', 'high', 'max'],
  defaultEffort: 'high',
  requestProtocol: 'openai-chat-completions'
}

export const CLAUDE_ADAPTIVE_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['low', 'medium', 'high', 'max'],
  defaultEffort: 'high',
  requestProtocol: 'anthropic-thinking'
}

export const DEEPSEEK_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['off', 'high', 'max'],
  defaultEffort: 'max',
  requestProtocol: 'deepseek-chat-completions'
}

export const ANTIGRAVITY_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['low', 'medium', 'high'],
  defaultEffort: 'medium',
  // The delegated runtime maps this to `agy --effort`; the HTTP request
  // protocol is intentionally unused.
  requestProtocol: 'none'
}

export const GEMINI_CLI_API_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['off', 'low', 'medium', 'high'],
  defaultEffort: 'medium',
  // The dedicated Gemini CLI API adapter maps this to generationConfig.thinkingConfig.
  requestProtocol: 'none'
}

export const CURSOR_SDK_ADAPTIVE_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['auto'],
  defaultEffort: 'auto',
  // Cursor's Agent SDK owns the model-specific thinking parameters. Omitting
  // explicit SDK params preserves its adaptive default for every model family.
  requestProtocol: 'none'
}

// Mixed-thinking Qwen models use the DashScope-compatible enable_thinking flag.
export const QWEN_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['auto', 'off'],
  defaultEffort: 'auto',
  requestProtocol: 'qwen-chat-completions'
}

// Tencent and Volcano OpenAI-compatible endpoints expose the thinking object.
export const HUNYUAN_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['auto', 'off'],
  defaultEffort: 'auto',
  requestProtocol: 'thinking-toggle-chat-completions'
}

export const DOUBAO_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['auto', 'off'],
  defaultEffort: 'auto',
  requestProtocol: 'thinking-toggle-chat-completions'
}

export const ZHIPU_CODING_PLAN_MODELS = [
  'glm-5.3',
  'glm-5.3-flash',
  'glm-5.2',
  'glm-5.1',
  'glm-5-turbo',
  'glm-4.7',
  'glm-4.5-air'
]

export const ZAI_CODING_PLAN_MODELS = [
  'glm-5.3',
  'glm-5.2',
  'glm-5.1',
  'glm-5',
  'glm-5-turbo',
  'glm-4.7',
  'glm-4.5-air'
]

export const MOONSHOT_CHAT_MODELS = [
  'kimi-k2.7-code',
  'kimi-k2.6',
  'kimi-k2.5',
  'moonshot-v1-128k',
  'moonshot-v1-32k',
  'moonshot-v1-8k'
]

export const VOLCENGINE_CHAT_MODELS = [
  'doubao-seed-2-1-pro-260628',
  'doubao-seed-2-1-turbo-260628',
  'doubao-seed-evolving',
  'doubao-seed-2-0-lite-260428',
  'doubao-seed-2-0-mini-260428'
]

export const VOLCENGINE_AGENT_PLAN_CHAT_MODELS = [
  'doubao-seed-2.1-turbo',
  'doubao-seed-evolving',
  'doubao-seed-2.0-lite',
  'doubao-seed-2.0-mini'
]

export const VOLCENGINE_IMAGE_MODELS = [
  'doubao-seedream-5-0-pro-260628',
  'doubao-seedream-5-0-260128',
  'doubao-seedream-5-0-lite-260128'
]

export const VOLCENGINE_VIDEO_MODELS = [
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128',
  'doubao-seedance-2-0-mini-260615'
]
