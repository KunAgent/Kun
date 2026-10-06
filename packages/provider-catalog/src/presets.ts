import type { ProviderCatalogPreset } from './index.js'
import { validateProviderCatalog } from './validation.js'
import preset0 from './definitions/litellm.json' with { type: 'json' }
import preset1 from './definitions/longcat.json' with { type: 'json' }
import preset2 from './definitions/claude-subscription.json' with { type: 'json' }
import preset3 from './definitions/gemini-subscription.json' with { type: 'json' }
import preset4 from './definitions/gemini-cli-subscription.json' with { type: 'json' }
import preset5 from './definitions/cursor-subscription.json' with { type: 'json' }
import preset6 from './definitions/ollama.json' with { type: 'json' }
import preset7 from './definitions/zhipu-coding-plan.json' with { type: 'json' }
import preset8 from './definitions/zai-coding-plan.json' with { type: 'json' }
import preset9 from './definitions/kimi-code.json' with { type: 'json' }
import preset10 from './definitions/volcengine.json' with { type: 'json' }
import preset11 from './definitions/volcengine-agent-plan.json' with { type: 'json' }
import preset12 from './definitions/volcengine-coding-plan.json' with { type: 'json' }
import preset13 from './definitions/opencode-go.json' with { type: 'json' }
import preset14 from './definitions/zenmux.json' with { type: 'json' }
import preset15 from './definitions/moonshot-cn.json' with { type: 'json' }
import preset16 from './definitions/moonshot-global.json' with { type: 'json' }
import preset17 from './definitions/xiaomi.json' with { type: 'json' }
import preset18 from './definitions/minimax.json' with { type: 'json' }
import preset19 from './definitions/aliyun.json' with { type: 'json' }
import preset20 from './definitions/tencentcloud.json' with { type: 'json' }
import preset21 from './definitions/codex.json' with { type: 'json' }
import preset22 from './definitions/grok-subscription.json' with { type: 'json' }
import preset23 from './definitions/opper.json' with { type: 'json' }
import preset24 from './definitions/vercel-ai-gateway.json' with { type: 'json' }
import preset25 from './definitions/stepfun.json' with { type: 'json' }
import preset26 from './definitions/openai-api.json' with { type: 'json' }
import preset27 from './definitions/anthropic-api.json' with { type: 'json' }
import preset28 from './definitions/gemini-api.json' with { type: 'json' }
import preset29 from './definitions/xai-api.json' with { type: 'json' }
import preset30 from './definitions/mistral-api.json' with { type: 'json' }
import preset31 from './definitions/groq-api.json' with { type: 'json' }
import preset32 from './definitions/zhipu-api.json' with { type: 'json' }
import preset33 from './definitions/zai-api.json' with { type: 'json' }
import preset34 from './definitions/openrouter.json' with { type: 'json' }
import preset35 from './definitions/siliconflow.json' with { type: 'json' }
import preset36 from './definitions/aihubmix.json' with { type: 'json' }
import preset37 from './definitions/three02ai.json' with { type: 'json' }
import preset38 from './definitions/together.json' with { type: 'json' }
import preset39 from './definitions/fireworks.json' with { type: 'json' }
import preset40 from './definitions/ollama-local.json' with { type: 'json' }
import preset41 from './definitions/lmstudio.json' with { type: 'json' }
import preset42 from './definitions/local-openai.json' with { type: 'json' }
import preset43 from './definitions/baidu-qianfan.json' with { type: 'json' }
import preset44 from './definitions/huaweicloud-maas.json' with { type: 'json' }
import preset45 from './definitions/tencent-tokenhub.json' with { type: 'json' }
import preset46 from './definitions/amazon-bedrock.json' with { type: 'json' }
import preset47 from './definitions/azure-openai.json' with { type: 'json' }
import preset48 from './definitions/nvidia-nim.json' with { type: 'json' }
import preset49 from './definitions/modelscope.json' with { type: 'json' }
import preset50 from './definitions/opencode-zen.json' with { type: 'json' }
import preset51 from './definitions/kilo-gateway.json' with { type: 'json' }
import preset52 from './definitions/commandcode.json' with { type: 'json' }
import preset53 from './definitions/pipellm.json' with { type: 'json' }
import preset54 from './definitions/cherryin.json' with { type: 'json' }
import preset55 from './definitions/yylx.json' with { type: 'json' }
import preset56 from './definitions/omlx.json' with { type: 'json' }

/** Declarative, validated defaults; existing connections retain their captured configuration. */
export const PROVIDER_CATALOG: readonly ProviderCatalogPreset[] = validateProviderCatalog([
  preset0,
  preset1,
  preset2,
  preset3,
  preset4,
  preset5,
  preset6,
  preset7,
  preset8,
  preset9,
  preset10,
  preset11,
  preset12,
  preset13,
  preset14,
  preset15,
  preset16,
  preset17,
  preset18,
  preset19,
  preset20,
  preset21,
  preset22,
  preset23,
  preset24,
  preset25,
  preset26,
  preset27,
  preset28,
  preset29,
  preset30,
  preset31,
  preset32,
  preset33,
  preset34,
  preset35,
  preset36,
  preset37,
  preset38,
  preset39,
  preset40,
  preset41,
  preset42,
  preset43,
  preset44,
  preset45,
  preset46,
  preset47,
  preset48,
  preset49,
  preset50,
  preset51,
  preset52,
  preset53,
  preset54,
  preset55,
  preset56
])
