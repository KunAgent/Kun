import type { ModelProviderEndpointsV1 } from './app-settings-types'
import type { ModelProviderPreset, ModelProviderTokenPlanRegion } from './model-provider-preset-types'

/**
 * Fourth batch: Chinese and global cloud platforms with several plans or
 * regions, plus relays and a local server. Every entry mirrors a schema v2
 * descriptor in `packages/provider-catalog/src/definitions`; the parity test
 * in `model-provider-presets.test.ts` keeps both sides aligned.
 */

const QIANFAN = 'https://qianfan.baidubce.com'
const HUAWEI = 'https://api.modelarts-maas.com'

function qianfanPlan(id: string, name: string, tier: string): ModelProviderTokenPlanRegion {
  const chat = `${QIANFAN}/v2/tokenplan/${tier}`
  return { id, name, baseUrl: chat, endpoints: { chat_completions: chat, responses: chat, messages: `${QIANFAN}/anthropic/tokenplan/${tier}` } }
}

function tokenhub(id: string, name: string, host: string): ModelProviderTokenPlanRegion {
  return { id, name, baseUrl: `https://${host}/v1`,
    endpoints: { chat_completions: `https://${host}/v1`, responses: `https://${host}/v1`, messages: `https://${host}` } }
}

function bedrock(region: string): ModelProviderTokenPlanRegion {
  const host = `https://bedrock-runtime.${region}.amazonaws.com`
  return { id: region, name: region, baseUrl: `${host}/openai/v1`,
    endpoints: { chat_completions: `${host}/openai/v1`, responses: `${host}/openai/v1`, messages: `${host}/anthropic` } }
}

function yylx(id: string, name: string, host: string): ModelProviderTokenPlanRegion {
  return { id, name, baseUrl: `https://${host}/v1`, endpoints: { chat_completions: `https://${host}/v1`, messages: `https://${host}` } }
}

const QIANFAN_PLANS = [qianfanPlan('personal', 'Personal', 'personal'), qianfanPlan('team', 'Enterprise', 'team')]
const TOKENHUB_REGIONS = [tokenhub('cn', 'China', 'tokenhub.tencentmaas.com'), tokenhub('intl', 'Global', 'tokenhub-intl.tencentmaas.com')]
const BEDROCK_REGIONS = ['us-east-1', 'us-east-2', 'us-west-2', 'eu-central-1', 'eu-west-1', 'ap-northeast-1', 'ap-southeast-1']
  .map(bedrock)
const YYLX_REGIONS = [yylx('auto', 'Auto', 'app.yylx.io'), yylx('global', 'Global', 'global.yylx.io'), yylx('cn', 'China Mainland', 'cn.yylx.io')]
const AZURE_EXAMPLE = 'https://your-resource.openai.azure.com/openai/v1'

function endpointsOf(region: ModelProviderTokenPlanRegion): ModelProviderEndpointsV1 {
  return { ...region.endpoints }
}

export const MODEL_PROVIDER_PRESETS_CLOUD: ModelProviderPreset[] = [
  {
    id: 'baidu-qianfan',
    name: 'Baidu Qianfan',
    origin: 'vendor',
    subscriptionRegion: 'china',
    note: 'Qianfan pay-as-you-go or Token Plan',
    baseUrl: `${QIANFAN}/v2`,
    endpoints: { chat_completions: `${QIANFAN}/v2`, responses: `${QIANFAN}/v2`, messages: `${QIANFAN}/anthropic` },
    endpointFormat: 'chat_completions',
    models: [],
    catalogSources: ['baidu'],
    tokenPlan: {
      displayName: 'Qianfan Token Plan',
      baseUrl: QIANFAN_PLANS[0]!.baseUrl,
      regions: QIANFAN_PLANS,
      endpoints: endpointsOf(QIANFAN_PLANS[0]!),
      endpointFormat: 'chat_completions',
      models: ['qianfan-code-latest', 'deepseek-v4.1-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v3.2',
        'glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-5.1', 'glm-5'],
      apiKeyUrl: 'https://console.bce.baidu.com/qianfan/resource/token-plan'
    },
    docsUrl: 'https://cloud.baidu.com/doc/qianfan/s/Dmrabu8b6',
    apiKeyUrl: 'https://console.bce.baidu.com/qianfan/ais/console/apiKey'
  },
  {
    id: 'huaweicloud-maas',
    name: 'Huawei Cloud MaaS',
    origin: 'vendor',
    subscriptionRegion: 'china',
    note: 'ModelArts MaaS pay-as-you-go or Token Plan',
    baseUrl: `${HUAWEI}/openai/v1`,
    endpoints: { chat_completions: `${HUAWEI}/openai/v1`, messages: `${HUAWEI}/anthropic` },
    endpointFormat: 'chat_completions',
    models: [],
    tokenPlan: {
      baseUrl: `${HUAWEI}/plan/v2`,
      endpoints: { chat_completions: `${HUAWEI}/plan/v2`, messages: `${HUAWEI}/plan/anthropic` },
      endpointFormat: 'chat_completions',
      models: ['glm-5.3', 'glm-5.1', 'kimi-k2.6', 'deepseek-v4.1-flash', 'deepseek-v4-flash'],
      apiKeyUrl: 'https://console.huaweicloud.com/modelarts/?#/model-studio/authmanage'
    },
    docsUrl: 'https://support.huaweicloud.com/usermanual-maas/maas_01_0001.html',
    apiKeyUrl: 'https://console.huaweicloud.com/modelarts/?#/model-studio/authmanage'
  },
  {
    id: 'tencent-tokenhub',
    name: 'Tencent TokenHub',
    origin: 'vendor',
    subscriptionRegion: 'china',
    note: 'Many vendors on one Tencent Cloud key',
    baseUrl: TOKENHUB_REGIONS[0]!.baseUrl,
    regions: TOKENHUB_REGIONS,
    regionLabel: 'Region',
    endpoints: endpointsOf(TOKENHUB_REGIONS[0]!),
    endpointFormat: 'chat_completions',
    models: [],
    docsUrl: 'https://cloud.tencent.com/document/product/1823/130078',
    apiKeyUrl: 'https://console.cloud.tencent.com/tokenhub/apikey'
  },
  {
    id: 'amazon-bedrock',
    name: 'Amazon Bedrock',
    origin: 'vendor',
    note: 'Bedrock API key; Claude over Anthropic Messages',
    baseUrl: BEDROCK_REGIONS[0]!.baseUrl,
    regions: BEDROCK_REGIONS,
    regionLabel: 'AWS region',
    endpoints: endpointsOf(BEDROCK_REGIONS[0]!),
    endpointFormat: 'messages',
    noList: true,
    models: ['global.anthropic.claude-opus-5-5', 'global.anthropic.claude-sonnet-5-5', 'global.anthropic.claude-sonnet-5',
      'global.anthropic.claude-opus-5', 'global.anthropic.claude-fable-5-1', 'global.anthropic.claude-haiku-4-5-20251001-v1:0'],
    docsUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html',
    apiKeyUrl: 'https://console.aws.amazon.com/bedrock/home#/api-keys'
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    origin: 'vendor',
    note: 'Your own Azure resource (v1 API)',
    baseUrl: AZURE_EXAMPLE,
    endpoints: { chat_completions: AZURE_EXAMPLE, responses: AZURE_EXAMPLE },
    endpointHint: 'https://<resource>.openai.azure.com/openai/v1 — the model id is your deployment name',
    endpointFormat: 'responses',
    models: [],
    catalogSources: ['azure', 'openai'],
    docsUrl: 'https://learn.microsoft.com/azure/ai-foundry/openai/api-version-lifecycle',
    apiKeyUrl: 'https://ai.azure.com'
  },
  {
    id: 'nvidia-nim',
    name: 'NVIDIA NIM',
    origin: 'relay',
    note: 'Hosted open models on build.nvidia.com',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    endpointFormat: 'chat_completions',
    models: [],
    catalogSources: ['nvidia'],
    docsUrl: 'https://docs.api.nvidia.com/nim/reference/llm-apis',
    apiKeyUrl: 'https://build.nvidia.com/settings/api-keys'
  },
  {
    id: 'modelscope',
    name: 'ModelScope',
    origin: 'relay',
    subscriptionRegion: 'china',
    note: 'API-Inference with a ModelScope token',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    endpoints: { chat_completions: 'https://api-inference.modelscope.cn/v1', responses: 'https://api-inference.modelscope.cn/v1' },
    endpointFormat: 'chat_completions',
    models: [],
    catalogSources: ['modelscope'],
    docsUrl: 'https://modelscope.cn/docs/model-service/API-Inference/intro',
    apiKeyUrl: 'https://modelscope.cn/my/myaccesstoken'
  },
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    origin: 'relay',
    note: 'Curated coding models; free tier without a key',
    keyOptional: true,
    baseUrl: 'https://opencode.ai/zen/v1',
    endpoints: { chat_completions: 'https://opencode.ai/zen/v1', responses: 'https://opencode.ai/zen/v1', messages: 'https://opencode.ai/zen' },
    endpointFormat: 'chat_completions',
    models: [],
    catalogSources: ['opencode'],
    docsUrl: 'https://opencode.ai/docs/zen',
    apiKeyUrl: 'https://opencode.ai/auth'
  },
  {
    id: 'kilo-gateway',
    name: 'Kilo Gateway',
    origin: 'relay',
    note: 'OpenRouter-compatible gateway; free models without a key',
    keyOptional: true,
    baseUrl: 'https://api.kilo.ai/api/openrouter',
    endpointFormat: 'chat_completions',
    models: [],
    docsUrl: 'https://kilo.ai/docs/gateway',
    apiKeyUrl: 'https://app.kilo.ai'
  },
  {
    id: 'commandcode',
    name: 'Command Code',
    origin: 'relay',
    note: 'Command Code provider key',
    baseUrl: 'https://api.commandcode.ai/provider/v1',
    endpoints: { chat_completions: 'https://api.commandcode.ai/provider/v1', responses: 'https://api.commandcode.ai/provider/v1',
      messages: 'https://api.commandcode.ai/provider' },
    endpointFormat: 'chat_completions',
    models: [],
    docsUrl: 'https://commandcode.ai/docs/provider',
    apiKeyUrl: 'https://commandcode.ai/settings/keys'
  },
  {
    id: 'pipellm',
    name: 'PipeLLM',
    origin: 'relay',
    note: 'Multi-vendor relay with native Anthropic and Responses',
    baseUrl: 'https://api.pipellm.ai/openai/v1',
    endpoints: { chat_completions: 'https://api.pipellm.ai/openai/v1', responses: 'https://api.pipellm.ai/v1', messages: 'https://api.pipellm.ai' },
    endpointFormat: 'chat_completions',
    models: [],
    docsUrl: 'https://www.pipellm.ai',
    apiKeyUrl: 'https://console.pipellm.ai'
  },
  {
    id: 'cherryin',
    name: 'CherryIN',
    origin: 'relay',
    subscriptionRegion: 'china',
    note: 'Multi-vendor relay',
    baseUrl: 'https://open.cherryin.ai/v1',
    endpoints: { chat_completions: 'https://open.cherryin.ai/v1', responses: 'https://open.cherryin.ai/v1', messages: 'https://open.cherryin.ai' },
    endpointFormat: 'chat_completions',
    models: [],
    balance: 'new-api',
    docsUrl: 'https://open.cherryin.ai',
    apiKeyUrl: 'https://open.cherryin.ai/console/token'
  },
  {
    id: 'yylx',
    name: 'YYLX',
    origin: 'relay',
    subscriptionRegion: 'china',
    note: 'Relay with regional entry points',
    baseUrl: YYLX_REGIONS[0]!.baseUrl,
    regions: YYLX_REGIONS,
    endpoints: endpointsOf(YYLX_REGIONS[0]!),
    endpointFormat: 'chat_completions',
    models: [],
    docsUrl: 'https://yylx.io',
    apiKeyUrl: 'https://app.yylx.io/keys'
  },
  {
    id: 'omlx',
    name: 'oMLX',
    origin: 'local',
    note: 'Local MLX server, no key required',
    keyOptional: true,
    baseUrl: 'http://localhost:8000/v1',
    endpointFormat: 'chat_completions',
    models: [],
    docsUrl: 'https://omlx.ai',
    apiKeyUrl: 'https://omlx.ai'
  }
]
