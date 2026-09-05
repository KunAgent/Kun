import { OPENCODE_FREE_MODELS } from './opencode-free-models.js'

export * from './antigravity-model-catalog.js'

export const TOKEN_PLAN_PROVIDER_ID_SUFFIX = '-token-plan'

export type ProviderCatalogCategory = 'api' | 'free' | 'subscription'
export type ProviderCatalogKind =
  | 'http'
  | 'agent-sdk'
  | 'antigravity-cli'
  | 'gemini-cli-api'
  | 'cursor-sdk'
export type ProviderCatalogAuthFlow =
  | 'api-key'
  | 'chatgpt-oauth'
  | 'grok-oauth'
  | 'claude-subscription'
  | 'gemini-subscription'
  | 'gemini-cli-subscription'
  | 'cursor-api-key'
export type ProviderCatalogAuthType = 'api-key' | 'oauth' | 'subscription'
export type ProviderCatalogCredentialRequirement = 'required' | 'optional' | 'none'
export type ProviderCatalogEndpointFormat =
  | 'chat_completions'
  | 'responses'
  | 'messages'
  | 'custom_endpoint'

export type ProviderCatalogTokenPlan = {
  /** Optional product-specific name used instead of the generic "Token Plan" label. */
  displayName?: string
  baseUrl: string
  regions?: ReadonlyArray<{ id: string; baseUrl: string }>
  endpointFormat: ProviderCatalogEndpointFormat
  models: readonly string[]
  credentialUrl: string
}

export type ProviderCatalogPreset = {
  id: string
  name: string
  category: ProviderCatalogCategory
  kind: ProviderCatalogKind
  authFlow: ProviderCatalogAuthFlow
  authType: ProviderCatalogAuthType
  credentialRequirement?: ProviderCatalogCredentialRequirement
  baseUrl: string
  endpointFormat: ProviderCatalogEndpointFormat
  models: readonly string[]
  docsUrl: string
  credentialUrl: string
  tokenPlan?: ProviderCatalogTokenPlan
}

export type ProviderCatalogEntry = {
  profileId: string
  presetSource: string
  presetId: string
  mode: 'api' | 'token-plan'
  label: string
  name: string
  category: ProviderCatalogCategory
  kind: ProviderCatalogKind
  authFlow: ProviderCatalogAuthFlow
  authType: ProviderCatalogAuthType
  credentialRequirement: ProviderCatalogCredentialRequirement
  baseUrl: string
  endpointFormat: ProviderCatalogEndpointFormat
  models: readonly string[]
  docsUrl: string
  credentialUrl: string
}

export type ProviderCatalogSource = {
  preset: ProviderCatalogPreset
  presetSource: string
  presetMode: 'api' | 'token-plan'
}

export type ProviderCatalogSourceInput = {
  id?: string
  presetSource?: string
  presetMode?: 'api' | 'token-plan'
}

const GEMINI_SUBSCRIPTION_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-pro'
] as const

const GEMINI_CLI_SUBSCRIPTION_MODELS = [
  'gemini-3.7-pro-preview',
  'gemini-3.7-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.5-flash'
] as const

const CURSOR_SUBSCRIPTION_MODELS = ['auto'] as const

const OLLAMA_CLOUD_MODELS = [
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

const VOLCENGINE_CHAT_MODELS = [
  'doubao-seed-2-1-pro-260628',
  'doubao-seed-2-1-turbo-260628',
  'doubao-seed-evolving',
  'doubao-seed-2-0-lite-260428',
  'doubao-seed-2-0-mini-260428'
] as const

const VOLCENGINE_AGENT_PLAN_CHAT_MODELS = [
  'doubao-seed-2.1-turbo',
  'doubao-seed-evolving',
  'doubao-seed-2.0-lite',
  'doubao-seed-2.0-mini'
] as const

const CHATGPT_SUBSCRIPTION_MODELS = [
  'gpt-5.5',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex-spark'
] as const

const GROK_SUBSCRIPTION_MODELS = [
  'grok-4.5',
  'grok-4-1-fast-reasoning',
  'grok-4-1-fast-non-reasoning',
  'grok-code-fast-1'
] as const

const MOONSHOT_MODELS = [
  'kimi-k2.7-code',
  'kimi-k2.6',
  'kimi-k2.5',
  'moonshot-v1-128k',
  'moonshot-v1-32k',
  'moonshot-v1-8k'
] as const

const MINIMAX_MODELS = [
  'MiniMax-M3',
  'MiniMax-M2.7',
  'MiniMax-M2.7-highspeed',
  'MiniMax-M2.5',
  'MiniMax-M2.5-highspeed',
  'MiniMax-M2.1',
  'MiniMax-M2.1-highspeed',
  'MiniMax-M2'
] as const

const ALIYUN_MODELS = [
  'qwen-max',
  'qwen-plus',
  'qwen-flash',
  'qwen3-coder-plus',
  'qwq-plus',
  'qwen-vl-max',
  'qwen3-vl-plus'
] as const

const TENCENT_MODELS = [
  'hunyuan-turbos-latest',
  'hunyuan-t1-latest',
  'hunyuan-lite'
] as const

/**
 * The connection-level source of truth shared by GUI Settings, Kun runtime,
 * and the terminal client. Capability/media metadata remains layered by the
 * consumers, but these fields must never be independently re-declared.
 */
export const PROVIDER_CATALOG = [
  {
    id: 'litellm',
    name: 'LiteLLM',
    category: 'api',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'api-key',
    baseUrl: 'http://localhost:4000',
    endpointFormat: 'chat_completions',
    models: [],
    docsUrl: 'https://docs.litellm.ai/docs/',
    credentialUrl: 'https://docs.litellm.ai/docs/proxy/quick_start'
  },
  {
    id: 'longcat',
    name: 'LongCat',
    category: 'api',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'api-key',
    baseUrl: 'https://api.longcat.chat/openai',
    endpointFormat: 'chat_completions',
    models: ['LongCat-2.0-Preview'],
    docsUrl: 'https://longcat.chat/platform/docs/zh/',
    credentialUrl: 'https://longcat.chat/platform/'
  },
  {
    id: 'claude-subscription',
    name: 'Claude (Pro/Max 订阅)',
    category: 'subscription',
    kind: 'agent-sdk',
    authFlow: 'claude-subscription',
    authType: 'subscription',
    baseUrl: 'https://api.anthropic.com',
    endpointFormat: 'messages',
    models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    docsUrl: 'https://code.claude.com/docs/en/authentication',
    credentialUrl: 'https://claude.ai'
  },
  {
    id: 'gemini-subscription',
    name: 'Google Antigravity 订阅',
    category: 'subscription',
    kind: 'antigravity-cli',
    authFlow: 'gemini-subscription',
    authType: 'subscription',
    baseUrl: '',
    endpointFormat: 'custom_endpoint',
    models: GEMINI_SUBSCRIPTION_MODELS,
    docsUrl: 'https://github.com/google-antigravity/antigravity-cli',
    credentialUrl: 'https://antigravity.google'
  },
  {
    id: 'gemini-cli-subscription',
    name: 'Gemini CLI 订阅（API）',
    category: 'subscription',
    kind: 'gemini-cli-api',
    authFlow: 'gemini-cli-subscription',
    authType: 'subscription',
    baseUrl: '',
    endpointFormat: 'custom_endpoint',
    models: GEMINI_CLI_SUBSCRIPTION_MODELS,
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    credentialUrl: 'https://github.com/google-gemini/gemini-cli#authentication-options'
  },
  {
    id: 'cursor-subscription',
    name: 'Cursor 订阅',
    category: 'subscription',
    kind: 'cursor-sdk',
    authFlow: 'cursor-api-key',
    authType: 'subscription',
    baseUrl: '',
    endpointFormat: 'custom_endpoint',
    models: CURSOR_SUBSCRIPTION_MODELS,
    docsUrl: 'https://cursor.com/docs/api/sdk/typescript',
    credentialUrl: 'https://cursor.com/dashboard/api?section=user-keys#user-api-keys'
  },
  {
    id: 'ollama',
    name: 'Ollama Cloud',
    category: 'subscription',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'subscription',
    baseUrl: 'https://ollama.com/v1',
    endpointFormat: 'chat_completions',
    models: OLLAMA_CLOUD_MODELS,
    docsUrl: 'https://docs.ollama.com/cloud',
    credentialUrl: 'https://ollama.com/settings/keys'
  },
  {
    id: 'zhipu-coding-plan',
    name: 'Zhipu Coding Plan',
    category: 'subscription',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'subscription',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
    endpointFormat: 'custom_endpoint',
    models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-5.1', 'glm-5-turbo', 'glm-4.7', 'glm-4.5-air'],
    docsUrl: 'https://docs.bigmodel.cn/cn/coding-plan/overview',
    credentialUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys'
  },
  {
    id: 'zai-coding-plan',
    name: 'Z.ai Coding Plan',
    category: 'subscription',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'subscription',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
    endpointFormat: 'custom_endpoint',
    models: ['glm-5.3', 'glm-5.2', 'glm-5.1', 'glm-5', 'glm-5-turbo', 'glm-4.7', 'glm-4.5-air'],
    docsUrl: 'https://docs.z.ai/devpack/tool/others',
    credentialUrl: 'https://z.ai/subscribe'
  },
  {
    id: 'kimi-code',
    name: 'Kimi Code',
    category: 'subscription',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'subscription',
    baseUrl: 'https://api.kimi.com/coding/v1',
    endpointFormat: 'chat_completions',
    models: ['k3', 'kimi-for-coding', 'kimi-for-coding-highspeed'],
    docsUrl: 'https://www.kimi.com/code/docs/en/',
    credentialUrl: 'https://www.kimi.com/code'
  },
  {
    id: 'volcengine',
    name: 'Volcano Ark API',
    category: 'api',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'api-key',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    endpointFormat: 'chat_completions',
    models: VOLCENGINE_CHAT_MODELS,
    docsUrl: 'https://www.volcengine.com/docs/82379/1330310',
    credentialUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey'
  },
  {
    id: 'volcengine-agent-plan',
    name: 'Volcano Ark Agent Plan',
    category: 'subscription',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'subscription',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    endpointFormat: 'chat_completions',
    models: VOLCENGINE_AGENT_PLAN_CHAT_MODELS,
    docsUrl: 'https://www.volcengine.com/docs/82379/2366394',
    credentialUrl:
      'https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&OpenModelVisible=false&advancedActiveKey=agentPlan'
  },
  {
    id: 'volcengine-coding-plan',
    name: 'Volcano Ark Coding Plan',
    category: 'subscription',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'subscription',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    endpointFormat: 'chat_completions',
    models: ['doubao-seed-1-6-250615', 'doubao-seed-1-6-flash-250828'],
    docsUrl: 'https://www.volcengine.com/docs/82379/1928262',
    credentialUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey'
  },
  {
    id: 'opencode-free',
    name: 'OpenCore Free',
    category: 'free',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'api-key',
    credentialRequirement: 'optional',
    baseUrl: 'https://opencode.ai/zen/v1',
    endpointFormat: 'chat_completions',
    models: OPENCODE_FREE_MODELS,
    docsUrl: 'https://opencode.ai/docs/zen/',
    credentialUrl: 'https://opencode.ai/docs/zen/'
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    category: 'subscription',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'subscription',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    endpointFormat: 'chat_completions',
    models: [
      'grok-4.5',
      'glm-5.2', 'glm-5.1', 'glm-5',
      'kimi-k2.7', 'kimi-k2.7-code', 'kimi-k2.6',
      'deepseek-v4-pro', 'deepseek-v4-flash',
      'mimo-v2.5', 'mimo-v2.5-pro', 'mimo-v2-pro', 'mimo-v2-omni',
      'minimax-m3', 'minimax-m2.7', 'minimax-m2.5',
      'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-plus', 'qwen3.5-plus'
    ],
    docsUrl: 'https://opencode.ai/docs/go/',
    credentialUrl: 'https://opencode.ai/auth'
  },
  {
    id: 'zenmux',
    name: 'ZenMux API',
    category: 'api',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'api-key',
    baseUrl: 'https://zenmux.ai/api/v1',
    endpointFormat: 'chat_completions',
    // ZenMux rotates a large aggregate catalog; Settings imports the live /models list.
    models: [],
    docsUrl: 'https://zenmux.ai/docs/guide/quickstart',
    credentialUrl: 'https://zenmux.ai/platform/pay-as-you-go',
    tokenPlan: {
      displayName: 'ZenMux Builder Plan (Coding Plan)',
      baseUrl: 'https://zenmux.ai/api/v1',
      endpointFormat: 'chat_completions',
      models: [],
      credentialUrl: 'https://zenmux.ai/platform/subscription'
    }
  },
  {
    id: 'moonshot-cn',
    name: 'Moonshot CN',
    category: 'api',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'api-key',
    baseUrl: 'https://api.moonshot.cn/v1',
    endpointFormat: 'chat_completions',
    models: MOONSHOT_MODELS,
    docsUrl: 'https://platform.moonshot.cn/docs',
    credentialUrl: 'https://platform.moonshot.cn/console/api-keys'
  },
  {
    id: 'moonshot-global',
    name: 'Moonshot Global',
    category: 'api',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'api-key',
    baseUrl: 'https://api.moonshot.ai/v1',
    endpointFormat: 'chat_completions',
    models: MOONSHOT_MODELS,
    docsUrl: 'https://platform.moonshot.ai/docs',
    credentialUrl: 'https://platform.moonshot.ai/console/api-keys'
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi',
    category: 'api',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'api-key',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    endpointFormat: 'chat_completions',
    models: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro', 'mimo-v2-omni'],
    docsUrl: 'https://platform.xiaomimimo.com/#/docs',
    credentialUrl: 'https://platform.xiaomimimo.com/#/console/api-keys',
    tokenPlan: {
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      regions: [
        { id: 'cn', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' },
        { id: 'sgp', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1' },
        { id: 'ams', baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1' }
      ],
      endpointFormat: 'chat_completions',
      models: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro', 'mimo-v2-omni'],
      credentialUrl: 'https://platform.xiaomimimo.com/docs/en-US/price/tokenplan/quick-access'
    }
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    category: 'api',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'api-key',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    endpointFormat: 'messages',
    models: MINIMAX_MODELS,
    docsUrl: 'https://platform.minimax.io/docs/api-reference/text-anthropic-api',
    credentialUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    tokenPlan: {
      baseUrl: 'https://api.minimaxi.com/anthropic',
      regions: [
        { id: 'cn', baseUrl: 'https://api.minimaxi.com/anthropic' },
        { id: 'global', baseUrl: 'https://api.minimax.io/anthropic' }
      ],
      endpointFormat: 'messages',
      models: MINIMAX_MODELS,
      credentialUrl: 'https://platform.minimaxi.com/docs/token-plan/quickstart'
    }
  },
  {
    id: 'aliyun',
    name: 'Aliyun',
    category: 'api',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'api-key',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    endpointFormat: 'chat_completions',
    models: ALIYUN_MODELS,
    docsUrl: 'https://help.aliyun.com/zh/model-studio/',
    credentialUrl: 'https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key',
    tokenPlan: {
      baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      regions: [
        { id: 'cn', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' },
        { id: 'sgp', baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1' }
      ],
      endpointFormat: 'chat_completions',
      models: ALIYUN_MODELS,
      credentialUrl: 'https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key'
    }
  },
  {
    id: 'tencentcloud',
    name: 'Tencent Cloud',
    category: 'api',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'api-key',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    endpointFormat: 'chat_completions',
    models: TENCENT_MODELS,
    docsUrl: 'https://cloud.tencent.com/document/product/1729/111006',
    credentialUrl: 'https://console.cloud.tencent.com/hunyuan/start',
    tokenPlan: {
      baseUrl: 'https://api.lkeap.cloud.tencent.com/plan/v3',
      endpointFormat: 'chat_completions',
      models: TENCENT_MODELS,
      credentialUrl: 'https://console.cloud.tencent.com/tokenhub/tokenplan'
    }
  },
  {
    id: 'codex',
    name: 'ChatGPT 订阅',
    category: 'subscription',
    kind: 'http',
    authFlow: 'chatgpt-oauth',
    authType: 'oauth',
    baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
    endpointFormat: 'custom_endpoint',
    models: CHATGPT_SUBSCRIPTION_MODELS,
    docsUrl: 'https://openai.com/index/codex/',
    credentialUrl: 'https://chatgpt.com'
  },
  {
    id: 'grok-subscription',
    name: 'Grok 订阅',
    category: 'subscription',
    kind: 'http',
    authFlow: 'grok-oauth',
    authType: 'oauth',
    baseUrl: 'https://cli-chat-proxy.grok.com/v1',
    endpointFormat: 'responses',
    models: GROK_SUBSCRIPTION_MODELS,
    docsUrl: 'https://docs.x.ai/',
    credentialUrl: 'https://accounts.x.ai'
  },
  {
    id: 'vercel-ai-gateway',
    name: 'Vercel AI Gateway',
    category: 'api',
    kind: 'http',
    authFlow: 'api-key',
    authType: 'api-key',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    endpointFormat: 'chat_completions',
    models: [],
    docsUrl: 'https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions',
    credentialUrl: 'https://vercel.com/ai-gateway'
  }
] as const satisfies readonly ProviderCatalogPreset[]

export function getProviderCatalogPreset(id: string): ProviderCatalogPreset | null {
  return PROVIDER_CATALOG.find((preset) => preset.id === id) ?? null
}

export function tokenPlanProviderId(presetId: string): string {
  return `${presetId}${TOKEN_PLAN_PROVIDER_ID_SUFFIX}`
}

/**
 * Resolves catalog identity independently from the provider/account id. The
 * numbered-account fallback is deliberately limited to known catalog IDs so a
 * custom provider sharing an endpoint is never silently reclassified.
 */
export function resolveProviderCatalogSource(
  input: ProviderCatalogSourceInput
): ProviderCatalogSource | null {
  const catalog: readonly ProviderCatalogPreset[] = PROVIDER_CATALOG
  const requestedSource = input.presetSource?.trim().toLowerCase()
  const explicitMode = input.presetMode
  if (requestedSource) {
    const explicit = catalog.find((preset) => preset.id === requestedSource)
    if (explicit && (!explicitMode || explicitMode === 'api' || explicit.tokenPlan)) {
      return {
        preset: explicit,
        presetSource: explicit.id,
        presetMode: explicitMode ?? (requestedSource.endsWith(TOKEN_PLAN_PROVIDER_ID_SUFFIX) ? 'token-plan' : 'api')
      }
    }
    if (requestedSource.endsWith(TOKEN_PLAN_PROVIDER_ID_SUFFIX)) {
      const presetId = requestedSource.slice(0, -TOKEN_PLAN_PROVIDER_ID_SUFFIX.length)
      const tokenPlanPreset = catalog.find((preset) => preset.id === presetId && preset.tokenPlan)
      if (tokenPlanPreset) {
        return { preset: tokenPlanPreset, presetSource: tokenPlanPreset.id, presetMode: 'token-plan' }
      }
    }
  }

  const id = input.id?.trim().toLowerCase() ?? ''
  const exact = catalog.find((preset) => preset.id === id)
  if (exact) return { preset: exact, presetSource: exact.id, presetMode: 'api' }
  const numbered = /^(.*)-(?:[2-9]|[1-9][0-9]+)$/u.exec(id)?.[1]
  if (!numbered) return null
  const baseId = numbered
  const tokenPlan = baseId.endsWith(TOKEN_PLAN_PROVIDER_ID_SUFFIX)
  const presetId = tokenPlan ? baseId.slice(0, -TOKEN_PLAN_PROVIDER_ID_SUFFIX.length) : baseId
  const preset = catalog.find((candidate) => candidate.id === presetId)
  if (!preset || (tokenPlan && !preset.tokenPlan)) return null
  return { preset, presetSource: preset.id, presetMode: tokenPlan ? 'token-plan' : 'api' }
}

export function providerCatalogEntries(): ProviderCatalogEntry[] {
  const catalog: readonly ProviderCatalogPreset[] = PROVIDER_CATALOG
  const entries = catalog.flatMap((preset): ProviderCatalogEntry[] => {
    const base: ProviderCatalogEntry = {
      profileId: preset.id,
      presetSource: preset.id,
      presetId: preset.id,
      mode: 'api',
      label: preset.name,
      name: preset.name,
      category: preset.category,
      kind: preset.kind,
      authFlow: preset.authFlow,
      authType: preset.authType,
      credentialRequirement: preset.credentialRequirement ?? 'required',
      baseUrl: preset.baseUrl,
      endpointFormat: preset.endpointFormat,
      models: [...preset.models],
      docsUrl: preset.docsUrl,
      credentialUrl: preset.credentialUrl
    }
    if (!preset.tokenPlan) return [base]
    const tokenPlanName = preset.tokenPlan.displayName?.trim() || `${preset.name} Token Plan`
    return [
      base,
      {
        profileId: tokenPlanProviderId(preset.id),
        presetSource: tokenPlanProviderId(preset.id),
        presetId: preset.id,
        mode: 'token-plan',
        label: preset.tokenPlan.displayName?.trim() || `${preset.name} · Token Plan`,
        name: tokenPlanName,
        category: 'subscription',
        kind: 'http',
        authFlow: 'api-key',
        authType: 'subscription',
        credentialRequirement: 'required',
        baseUrl: preset.tokenPlan.baseUrl,
        endpointFormat: preset.tokenPlan.endpointFormat,
        models: [...preset.tokenPlan.models],
        docsUrl: preset.docsUrl,
        credentialUrl: preset.tokenPlan.credentialUrl
      }
    ]
  })
  return [
    ...entries.filter((entry) => entry.category === 'free'),
    ...entries.filter((entry) => entry.category === 'subscription'),
    ...entries.filter((entry) => entry.category === 'api')
  ]
}
