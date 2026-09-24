import {
  textChatProfile,
  visionChatProfile
} from './model-provider-preset-profile-builders'
import {
  CLAUDE_ADAPTIVE_REASONING,
  GLM_REASONING,
  GROK_RESPONSES_REASONING,
  type ModelProviderPreset
} from './model-provider-preset-types'

/**
 * Third batch: mainstream vendor APIs, relay/aggregator gateways, and local
 * servers. Most entries ship with `models: []` — the model list is fetched
 * from the live `/models` endpoint after the key is saved, and metadata is
 * completed from the configured models.dev `catalogSources`.
 */
export const MODEL_PROVIDER_PRESETS_THIRDPARTY: ModelProviderPreset[] = [
  {
    id: 'openai-api',
    name: 'OpenAI API',
    origin: 'vendor',
    note: 'Pay-as-you-go OpenAI platform key',
    baseUrl: 'https://api.openai.com/v1',
    endpointFormat: 'chat_completions',
    models: [],
    catalogSources: ['openai'],
    docsUrl: 'https://platform.openai.com/docs',
    apiKeyUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'anthropic-api',
    name: 'Anthropic API',
    origin: 'vendor',
    note: 'Pay-as-you-go Anthropic Console key',
    baseUrl: 'https://api.anthropic.com',
    endpointFormat: 'messages',
    models: [],
    catalogSources: ['anthropic'],
    docsUrl: 'https://docs.anthropic.com',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'gemini-api',
    name: 'Google Gemini API',
    origin: 'vendor',
    note: 'AI Studio key, OpenAI-compatible endpoint',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    endpointFormat: 'chat_completions',
    models: [],
    catalogSources: ['google'],
    docsUrl: 'https://ai.google.dev/gemini-api/docs/openai',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey'
  },
  {
    id: 'xai-api',
    name: 'xAI API',
    origin: 'vendor',
    note: 'Pay-as-you-go xAI key (separate from Grok subscription)',
    baseUrl: 'https://api.x.ai/v1',
    endpointFormat: 'chat_completions',
    models: [],
    modelProfiles: {
      'grok-4.5': visionChatProfile(500_000, GROK_RESPONSES_REASONING)
    },
    catalogSources: ['xai'],
    docsUrl: 'https://docs.x.ai/',
    apiKeyUrl: 'https://console.x.ai/'
  },
  {
    id: 'mistral-api',
    name: 'Mistral API',
    origin: 'vendor',
    note: 'La Plateforme pay-as-you-go key',
    baseUrl: 'https://api.mistral.ai/v1',
    endpointFormat: 'chat_completions',
    models: [],
    catalogSources: ['mistral'],
    docsUrl: 'https://docs.mistral.ai/',
    apiKeyUrl: 'https://console.mistral.ai/api-keys'
  },
  {
    id: 'groq-api',
    name: 'Groq API',
    origin: 'vendor',
    note: 'Low-latency inference, pay-as-you-go',
    baseUrl: 'https://api.groq.com/openai/v1',
    endpointFormat: 'chat_completions',
    models: [],
    catalogSources: ['groq'],
    docsUrl: 'https://console.groq.com/docs',
    apiKeyUrl: 'https://console.groq.com/keys'
  },
  {
    id: 'zhipu-api',
    name: 'Zhipu Open Platform',
    origin: 'vendor',
    subscriptionRegion: 'china',
    note: 'BigModel pay-as-you-go (glm series)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    endpointFormat: 'chat_completions',
    models: [],
    modelProfiles: {
      'glm-5': textChatProfile(200_000, GLM_REASONING)
    },
    catalogSources: ['zhipuai', 'zai'],
    docsUrl: 'https://docs.bigmodel.cn/',
    apiKeyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys'
  },
  {
    id: 'zai-api',
    name: 'Z.ai API',
    origin: 'vendor',
    subscriptionRegion: 'china',
    note: 'Z.ai pay-as-you-go (glm series)',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    endpointFormat: 'chat_completions',
    models: [],
    catalogSources: ['zai', 'zhipuai'],
    docsUrl: 'https://docs.z.ai/',
    apiKeyUrl: 'https://z.ai/manage-apikey/apikey-list'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    origin: 'relay',
    note: 'Many vendors behind one key',
    baseUrl: 'https://openrouter.ai/api/v1',
    endpointFormat: 'chat_completions',
    models: [],
    catalogSources: ['openrouter'],
    docsUrl: 'https://openrouter.ai/docs',
    apiKeyUrl: 'https://openrouter.ai/settings/keys'
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    origin: 'relay',
    subscriptionRegion: 'china',
    note: 'Aggregated open models, CN endpoint',
    baseUrl: 'https://api.siliconflow.cn/v1',
    endpointFormat: 'chat_completions',
    models: [],
    catalogSources: ['siliconflow'],
    docsUrl: 'https://docs.siliconflow.cn/',
    apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak'
  },
  {
    id: 'aihubmix',
    name: 'AiHubMix',
    origin: 'relay',
    subscriptionRegion: 'china',
    note: 'Multi-vendor relay, one key',
    baseUrl: 'https://aihubmix.com/v1',
    endpointFormat: 'chat_completions',
    models: [],
    catalogSources: ['aihubmix'],
    docsUrl: 'https://docs.aihubmix.com/',
    apiKeyUrl: 'https://aihubmix.com/token'
  },
  {
    id: 'three02ai',
    name: '302.AI',
    origin: 'relay',
    subscriptionRegion: 'china',
    note: 'Pay-as-you-go multi-vendor relay',
    baseUrl: 'https://api.302.ai/v1',
    endpointFormat: 'chat_completions',
    models: [],
    catalogSources: ['302.ai'],
    docsUrl: 'https://302.ai/',
    apiKeyUrl: 'https://dash.302.ai/apis/list'
  },
  {
    id: 'together',
    name: 'Together',
    origin: 'relay',
    note: 'Open-weight model hosting',
    baseUrl: 'https://api.together.xyz/v1',
    endpointFormat: 'chat_completions',
    models: [],
    catalogSources: ['together'],
    docsUrl: 'https://docs.together.ai/',
    apiKeyUrl: 'https://api.together.ai/settings/api-keys'
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    origin: 'relay',
    note: 'Fast open-model inference',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    endpointFormat: 'chat_completions',
    models: [],
    catalogSources: ['fireworks'],
    docsUrl: 'https://docs.fireworks.ai/',
    apiKeyUrl: 'https://fireworks.ai/account/api-keys'
  },
  {
    id: 'ollama-local',
    name: 'Ollama (Local)',
    origin: 'local',
    note: 'Local models, no key required',
    keyOptional: true,
    baseUrl: 'http://localhost:11434/v1',
    endpointFormat: 'chat_completions',
    models: [],
    catalogSources: ['ollama'],
    docsUrl: 'https://docs.ollama.com/openai',
    apiKeyUrl: 'https://docs.ollama.com/'
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    origin: 'local',
    note: 'Local server, no key required',
    keyOptional: true,
    baseUrl: 'http://localhost:1234/v1',
    endpointFormat: 'chat_completions',
    models: [],
    catalogSources: ['lmstudio'],
    docsUrl: 'https://lmstudio.ai/docs',
    apiKeyUrl: 'https://lmstudio.ai/docs'
  },
  {
    id: 'local-openai',
    name: 'Local OpenAI-Compatible',
    origin: 'local',
    note: 'vLLM / sglang / any local server',
    keyOptional: true,
    baseUrl: 'http://localhost:8000/v1',
    endpointFormat: 'chat_completions',
    models: [],
    docsUrl: 'https://docs.vllm.ai/',
    apiKeyUrl: 'https://docs.vllm.ai/'
  }
]
