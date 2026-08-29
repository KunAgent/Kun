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
  ANTIGRAVITY_REASONING,
  CLAUDE_ADAPTIVE_REASONING,
  CURSOR_SDK_ADAPTIVE_REASONING,
  CURSOR_SUBSCRIPTION_MODEL_IDS,
  CURSOR_SUBSCRIPTION_NAME,
  CURSOR_SUBSCRIPTION_PROVIDER_ID,
  DEEPSEEK_REASONING,
  DOUBAO_REASONING,
  GEMINI_CLI_API_REASONING,
  GEMINI_CLI_SUBSCRIPTION_MODEL_IDS,
  GEMINI_CLI_SUBSCRIPTION_NAME,
  GEMINI_CLI_SUBSCRIPTION_PROVIDER_ID,
  GEMINI_SUBSCRIPTION_MODEL_IDS,
  GEMINI_SUBSCRIPTION_NAME,
  GEMINI_SUBSCRIPTION_PROVIDER_ID,
  GLM_REASONING,
  GROK_CHAT_REASONING,
  KIMI_K3_REASONING,
  MOONSHOT_CHAT_MODELS,
  ModelProviderPreset,
  OLLAMA_CLOUD_MODEL_IDS,
  OLLAMA_CLOUD_PROVIDER_ID,
  OLLAMA_CLOUD_PROVIDER_NAME,
  OPENCODE_FREE_MODEL_IDS,
  OPENCODE_FREE_PROVIDER_ID,
  OPENCODE_FREE_PROVIDER_NAME,
  VOLCENGINE_AGENT_PLAN_CHAT_MODELS,
  VOLCENGINE_CHAT_MODELS,
  VOLCENGINE_IMAGE_MODELS,
  VOLCENGINE_VIDEO_MODELS,
  ZAI_CODING_PLAN_MODELS,
  ZHIPU_CODING_PLAN_MODELS
} from './model-provider-preset-types'

const OPENCODE_FREE_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['auto'],
  defaultEffort: 'auto',
  requestProtocol: 'none'
}

/** models.dev/kun-agent explicitly publish Coding Plan models as zero-cost. */
function codingPlanProfile(
  contextWindowTokens: number,
  vision = false
): ModelProviderModelProfileV1 {
  return {
    ...(vision
      ? visionChatProfile(contextWindowTokens, GLM_REASONING)
      : textChatProfile(contextWindowTokens, GLM_REASONING)),
    pricing: {
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
      cacheReadUsdPerMillion: 0,
      cacheWriteUsdPerMillion: 0
    }
  }
}

export const MODEL_PROVIDER_PRESETS_CORE: ModelProviderPreset[] = [
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
    id: 'claude-subscription',
    name: 'Claude (Pro/Max 订阅)',
    category: 'subscription',
    subscriptionRegion: 'united-states',
    // Delegates whole turns to the official Claude Agent SDK so requests draw on
    // the user's Claude subscription. baseUrl is unused for this kind (kept for
    // display); auth comes from the host's Claude Code login or a pasted
    // CLAUDE_CODE_OAUTH_TOKEN in the API Key field.
    kind: 'agent-sdk',
    baseUrl: 'https://api.anthropic.com',
    endpointFormat: 'messages',
    // Ids match what the SDK's supportedModels() returns (see claude-subscription-models).
    models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    // The SDK does NOT report a context window, so we set it manually: Opus 4.8 and
    // Sonnet 4.x support 1M; Haiku 4.5 is 200K. All Claude 4.x models are vision-capable,
    // so every profile uses visionChatProfile (inputModalities text+image). Cosmetic on
    // the agent-sdk path (the SDK enforces the real limit); preset profiles are
    // authoritative, so edit them here.
    modelProfiles: {
      'claude-opus-4-8': visionChatProfile(1_000_000, CLAUDE_ADAPTIVE_REASONING),
      'claude-sonnet-4-6': visionChatProfile(1_000_000, CLAUDE_ADAPTIVE_REASONING),
      'claude-haiku-4-5': visionChatProfile(200_000)
    },
    docsUrl: 'https://code.claude.com/docs/en/authentication',
    apiKeyUrl: 'https://claude.ai'
  },
{
    id: GEMINI_SUBSCRIPTION_PROVIDER_ID,
    name: GEMINI_SUBSCRIPTION_NAME,
    category: 'subscription',
    subscriptionRegion: 'united-states',
    // Antigravity subscription models are served by Google's official
    // Antigravity CLI. Do not route this provider's ids through the separate
    // Gemini CLI Code Assist API transport or the public API-key endpoint.
    kind: 'antigravity-cli',
    baseUrl: '',
    endpointFormat: 'custom_endpoint',
    models: [...GEMINI_SUBSCRIPTION_MODEL_IDS],
    modelProfiles: Object.fromEntries(
      GEMINI_SUBSCRIPTION_MODEL_IDS.map((model) => [
        model,
        visionChatProfile(1_048_576, ANTIGRAVITY_REASONING)
      ])
    ),
    docsUrl: 'https://github.com/google-antigravity/antigravity-cli',
    apiKeyUrl: 'https://antigravity.google'
  },
{
    id: GEMINI_CLI_SUBSCRIPTION_PROVIDER_ID,
    name: GEMINI_CLI_SUBSCRIPTION_NAME,
    category: 'subscription',
    subscriptionRegion: 'united-states',
    // Reuses the official Gemini CLI's OAuth credential and direct Code Assist
    // API contract. This is a native Kun model transport, not an Antigravity
    // whole-turn delegation and not the public API-key endpoint.
    kind: 'gemini-cli-api',
    baseUrl: '',
    endpointFormat: 'custom_endpoint',
    models: [...GEMINI_CLI_SUBSCRIPTION_MODEL_IDS],
    modelProfiles: Object.fromEntries(
      GEMINI_CLI_SUBSCRIPTION_MODEL_IDS.map((model) => [
        model,
        visionChatProfile(1_048_576, GEMINI_CLI_API_REASONING)
      ])
    ),
    speech: {
      protocol: 'gemini-cli-audio',
      baseUrl: '',
      models: [...GEMINI_CLI_SUBSCRIPTION_MODEL_IDS]
    },
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    apiKeyUrl: 'https://github.com/google-gemini/gemini-cli#authentication-options'
  },
{
    id: CURSOR_SUBSCRIPTION_PROVIDER_ID,
    name: CURSOR_SUBSCRIPTION_NAME,
    category: 'subscription',
    subscriptionRegion: 'united-states',
    // Cursor exposes an official Agent SDK instead of an OpenAI-compatible
    // subscription endpoint. Account-visible models are pulled after the user
    // supplies a Cursor API key; `auto` remains the offline fallback.
    kind: 'cursor-sdk',
    baseUrl: '',
    endpointFormat: 'custom_endpoint',
    models: [...CURSOR_SUBSCRIPTION_MODEL_IDS],
    modelProfiles: {
      auto: textChatProfile(undefined, CURSOR_SDK_ADAPTIVE_REASONING)
    },
    docsUrl: 'https://cursor.com/docs/api/sdk/typescript',
    apiKeyUrl: 'https://cursor.com/dashboard/api?section=user-keys#user-api-keys'
  },
{
    id: OLLAMA_CLOUD_PROVIDER_ID,
    name: OLLAMA_CLOUD_PROVIDER_NAME,
    category: 'subscription',
    subscriptionRegion: 'united-states',
    // Ollama Cloud documents an OpenAI-compatible surface, so Kun can retain
    // its single HTTP model loop (streaming, tools, images, and usage) instead
    // of adding a parallel native /api/chat transport.
    baseUrl: 'https://ollama.com/v1',
    endpointFormat: 'chat_completions',
    models: [...OLLAMA_CLOUD_MODEL_IDS],
    docsUrl: 'https://docs.ollama.com/cloud',
    apiKeyUrl: 'https://ollama.com/settings/keys'
  },
{
    id: 'zhipu-coding-plan',
    name: 'Zhipu Coding Plan',
    category: 'subscription',
    subscriptionRegion: 'china',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
    endpointFormat: 'custom_endpoint',
    models: [...ZHIPU_CODING_PLAN_MODELS],
    modelProfiles: {
      'glm-5.3': codingPlanProfile(1_000_000),
      // VLM variant per docs.bigmodel.cn (vlm/glm-5.3-flash); available in the GLM Coding Plan.
      'glm-5.3-flash': codingPlanProfile(200_000, true),
      'glm-5.2': codingPlanProfile(1_000_000),
      'glm-5.1': codingPlanProfile(200_000),
      'glm-5-turbo': codingPlanProfile(200_000),
      'glm-4.7': codingPlanProfile(200_000),
      'glm-4.5-air': codingPlanProfile(200_000)
    },
    docsUrl: 'https://docs.bigmodel.cn/cn/coding-plan/overview',
    apiKeyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys'
  },
{
    id: 'zai-coding-plan',
    name: 'Z.ai Coding Plan',
    category: 'subscription',
    subscriptionRegion: 'china',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
    endpointFormat: 'custom_endpoint',
    models: [...ZAI_CODING_PLAN_MODELS],
    modelProfiles: {
      'glm-5.3': codingPlanProfile(1_000_000),
      'glm-5.2': codingPlanProfile(1_000_000),
      'glm-5.1': codingPlanProfile(200_000),
      'glm-5': codingPlanProfile(200_000),
      'glm-5-turbo': codingPlanProfile(200_000),
      'glm-4.7': codingPlanProfile(200_000),
      'glm-4.5-air': codingPlanProfile(200_000)
    },
    docsUrl: 'https://docs.z.ai/devpack/tool/others',
    apiKeyUrl: 'https://z.ai/subscribe'
  },
{
    id: 'kimi-code',
    name: 'Kimi Code',
    category: 'subscription',
    subscriptionRegion: 'china',
    baseUrl: 'https://api.kimi.com/coding/v1',
    endpointFormat: 'chat_completions',
    models: ['k3', 'kimi-for-coding', 'kimi-for-coding-highspeed'],
    modelProfiles: {
      // Reference prices mirror the public Moonshot API (moonshotai-cn on
      // models.dev, fetched 2026-08-22). Kimi Code is a subscription plan, so
      // these are reference estimates, not actual charges.
      k3: {
        ...visionChatProfile(1_000_000, KIMI_K3_REASONING),
        pricing: { inputUsdPerMillion: 3, outputUsdPerMillion: 15, cacheReadUsdPerMillion: 0.3 }
      },
      'kimi-for-coding': {
        ...textChatProfile(262_144),
        pricing: { inputUsdPerMillion: 0.95, outputUsdPerMillion: 4, cacheReadUsdPerMillion: 0.19 }
      },
      'kimi-for-coding-highspeed': {
        ...textChatProfile(262_144),
        pricing: { inputUsdPerMillion: 1.9, outputUsdPerMillion: 8, cacheReadUsdPerMillion: 0.38 }
      }
    },
    docsUrl: 'https://www.kimi.com/code/docs/en/',
    apiKeyUrl: 'https://www.kimi.com/code'
  },
{
    id: 'volcengine',
    name: 'Volcano Ark API',
    subscriptionRegion: 'china',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    endpointFormat: 'chat_completions',
    models: [...VOLCENGINE_CHAT_MODELS],
    modelProfiles: {
      'doubao-seed-2-1-pro-260628': visionChatProfile(256_000, DOUBAO_REASONING),
      'doubao-seed-2-1-turbo-260628': visionChatProfile(256_000, DOUBAO_REASONING),
      'doubao-seed-evolving': visionChatProfile(1_024_000, DOUBAO_REASONING),
      'doubao-seed-2-0-lite-260428': visionChatProfile(256_000, DOUBAO_REASONING),
      'doubao-seed-2-0-mini-260428': visionChatProfile(256_000, DOUBAO_REASONING)
    },
    image: {
      protocol: 'volcengine-ark-image',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      models: [...VOLCENGINE_IMAGE_MODELS]
    },
    video: {
      protocol: 'volcengine-ark-video',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      models: [...VOLCENGINE_VIDEO_MODELS]
    },
    docsUrl: 'https://www.volcengine.com/docs/82379/1330310',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey'
  },
{
    id: 'volcengine-agent-plan',
    name: 'Volcano Ark Agent Plan',
    category: 'subscription',
    subscriptionRegion: 'china',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    endpointFormat: 'chat_completions',
    models: [...VOLCENGINE_AGENT_PLAN_CHAT_MODELS],
    modelProfiles: {
      'doubao-seed-2.1-turbo': visionChatProfile(256_000, DOUBAO_REASONING),
      'doubao-seed-evolving': visionChatProfile(1_024_000, DOUBAO_REASONING),
      'doubao-seed-2.0-lite': visionChatProfile(256_000, DOUBAO_REASONING),
      'doubao-seed-2.0-mini': visionChatProfile(256_000, DOUBAO_REASONING)
    },
    image: {
      protocol: 'volcengine-ark-image',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
      models: ['doubao-seedream-5.0-lite']
    },
    video: {
      protocol: 'volcengine-ark-video',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
      models: ['doubao-seedance-2.0', 'doubao-seedance-2.0-fast', 'doubao-seedance-2.0-mini']
    },
    docsUrl: 'https://www.volcengine.com/docs/82379/2366394',
    apiKeyUrl:
      'https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&OpenModelVisible=false&advancedActiveKey=agentPlan'
  },
{
    id: 'volcengine-coding-plan',
    name: 'Volcano Ark Coding Plan',
    category: 'subscription',
    subscriptionRegion: 'china',
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
    id: OPENCODE_FREE_PROVIDER_ID,
    name: OPENCODE_FREE_PROVIDER_NAME,
    category: 'free',
    // Anonymous requests use Bearer public; the gateway treats it as no
    // account key and permits only allowAnonymous models.
    baseUrl: 'https://opencode.ai/zen/v1',
    endpointFormat: 'chat_completions',
    defaultRetryMaxAttempts: 10,
    models: [...OPENCODE_FREE_MODEL_IDS],
    modelProfiles: {
      'big-pickle': openCodeFreeProfile(200_000, 32_000),
      'mimo-v2.5-free': openCodeFreeProfile(200_000, 32_000, true),
      'ling-3.0-flash-fin-free': openCodeFreeProfile(262_144, 32_768),
      'nemotron-3-ultra-free': openCodeFreeProfile(1_000_000, 128_000),
      'nemotron-3.5-lightning-free': openCodeFreeProfile(262_144, 262_144)
    },
    docsUrl: 'https://opencode.ai/docs/zen/',
    apiKeyUrl: 'https://opencode.ai/docs/zen/'
  },
{
    id: 'opencode-go',
    name: 'OpenCode Go',
    category: 'subscription',
    subscriptionRegion: 'united-states',
    // 网关默认走 chat_completions;MiniMax / Qwen 系列在 OpenCode Go 上以
    // Anthropic Messages 格式提供,故按模型用 endpointFormat:'messages' 覆盖
    // (请求改打 …/zen/go/v1/messages)。
    baseUrl: 'https://opencode.ai/zen/go/v1',
    endpointFormat: 'chat_completions',
    models: [
      'grok-4.5',
      'glm-5.2',
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
      'grok-4.5': {
        ...visionChatProfile(500_000, GROK_CHAT_REASONING),
        maxOutputTokens: 64_000
      },
      'glm-5.2': visionChatProfile(1_000_000, GLM_REASONING),
      'glm-5.1': visionChatProfile(131_072, GLM_REASONING),
      'glm-5': visionChatProfile(131_072, GLM_REASONING),
      'kimi-k2.7': textChatProfile(131_072),
      'kimi-k2.7-code': textChatProfile(131_072),
      'kimi-k2.6': textChatProfile(131_072),
      'deepseek-v4-pro': textChatProfile(1_000_000, DEEPSEEK_REASONING),
      'deepseek-v4-flash': textChatProfile(1_000_000, DEEPSEEK_REASONING),
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
    id: 'zenmux',
    name: 'ZenMux API',
    subscriptionRegion: 'united-states',
    baseUrl: 'https://zenmux.ai/api/v1',
    endpointFormat: 'chat_completions',
    // ZenMux rotates a large aggregate catalog; Settings imports the live /models list.
    models: [],
    tokenPlan: {
      displayName: 'ZenMux Builder Plan (Coding Plan)',
      baseUrl: 'https://zenmux.ai/api/v1',
      endpointFormat: 'chat_completions',
      models: [],
      keyPrefix: 'sk-ss-v1-',
      apiKeyUrl: 'https://zenmux.ai/platform/subscription'
    },
    docsUrl: 'https://zenmux.ai/docs/guide/quickstart',
    apiKeyUrl: 'https://zenmux.ai/platform/pay-as-you-go'
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
  }
]

function openCodeFreeProfile(
  contextWindowTokens: number,
  maxOutputTokens: number,
  supportsImageInput = false,
  supportsReasoning = true
): ModelProviderModelProfileV1 {
  return {
    ...(supportsImageInput
      ? visionChatProfile(contextWindowTokens, supportsReasoning ? OPENCODE_FREE_REASONING : undefined)
      : textChatProfile(contextWindowTokens, supportsReasoning ? OPENCODE_FREE_REASONING : undefined)),
    maxOutputTokens
  }
}
