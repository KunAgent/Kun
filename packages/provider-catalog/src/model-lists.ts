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

export {
  ALIYUN_MODELS,
  CHATGPT_SUBSCRIPTION_MODELS,
  CURSOR_SUBSCRIPTION_MODELS,
  GEMINI_CLI_SUBSCRIPTION_MODELS,
  GEMINI_SUBSCRIPTION_MODELS,
  GROK_SUBSCRIPTION_MODELS,
  MINIMAX_MODELS,
  MOONSHOT_MODELS,
  OLLAMA_CLOUD_MODELS,
  TENCENT_MODELS,
  VOLCENGINE_AGENT_PLAN_CHAT_MODELS,
  VOLCENGINE_CHAT_MODELS
}
