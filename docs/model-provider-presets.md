# Model Provider Presets

## Context

DeepChat handles model suppliers in two layers:

- A default provider catalog stores provider id, display name, base URL, API type,
  documentation links, and whether the provider is enabled.
- A runtime registry maps each provider or API type to a request protocol such as
  OpenAI-compatible chat completions or Anthropic messages.

Kun already has the runtime half in a smaller form. Settings store
`provider.providers[]`, the active Kun runtime stores `providerId`, and the
runtime resolves the selected provider into API key, base URL, and endpoint
format. The model endpoint formats already cover OpenAI Chat Completions,
OpenAI Responses, and Anthropic Messages.

## Design

Do not add a second runtime or a DeepChat-style provider presenter. Add a small
shared provider preset catalog that produces existing `ModelProviderProfileV1`
objects.

The Settings > Providers panel should let users:

- add a blank custom provider as before,
- add a known preset provider,
- select the newly added preset as the active Kun provider,
- keep provider fields editable after creation,
- configure optional image-generation capabilities on a provider.

Preset providers remain opt-in because this project does not have a separate
enabled/disabled provider flag. Adding every known provider by default would
make all of their models appear in the composer before credentials are set.

## Built-in Providers

Vercel AI Gateway:

- id: `vercel-ai-gateway`
- base URL: `https://ai-gateway.vercel.sh/v1`
- endpoint format: OpenAI Chat Completions
- models: imported on demand from the gateway `GET /models` endpoint
- role: optional multi-provider gateway with Vercel-managed routing, fallback,
  spend monitoring, and BYOK support
- behavior: direct providers remain the default; adding this preset does not
  route existing providers through Vercel

DeepSeek:

- id: `deepseek`
- base URL: `https://api.deepseek.com`
- endpoint format: OpenAI Chat Completions compatible
- default models: `deepseek-v4-pro`, `deepseek-v4-flash`
- compatibility aliases: `deepseek-chat`, `deepseek-reasoner`
- role: default text/reasoning provider for first-run setup and existing installs

Xiaomi:

- id: `xiaomi`
- base URL: `https://api.xiaomimimo.com/v1`
- endpoint format: OpenAI Chat Completions
- initial models: `mimo-v2-omni`, `mimo-v2.5-pro-ultraspeed`,
  `mimo-v2-pro`, `mimo-v2.5`, `mimo-v2.5-pro`

MiniMax:

- id: `minimax`
- base URL: `https://api.minimaxi.com/anthropic`
- endpoint format: Anthropic Messages
- initial models: `MiniMax-M2.5`, `MiniMax-M3`,
  `MiniMax-M2.5-highspeed`, `MiniMax-M2.7`, `MiniMax-M2`,
  `MiniMax-M2.7-highspeed`, `MiniMax-M2.1`
- image protocol: MiniMax `/v1/image_generation`
- image base URL: `https://api.minimaxi.com`
- image models: `image-01`

Zhipu Coding Plan:

- id: `zhipu-coding-plan`
- base URL: `https://open.bigmodel.cn/api/coding/paas/v4`
- endpoint format: OpenAI Chat Completions
- initial models: `glm-5.2`, `glm-5.1`, `glm-5-turbo`, `glm-4.7`,
  `glm-4.5-air`
- role: coding subscription provider added from Settings > Providers only

Z.ai Coding Plan:

- id: `zai-coding-plan`
- base URL: `https://api.z.ai/api/coding/paas/v4`
- endpoint format: OpenAI Chat Completions
- initial models: `glm-5.1`, `glm-5`, `glm-5-turbo`, `glm-4.7`,
  `glm-4.5-air`
- role: international coding subscription provider added from Settings >
  Providers only

Kimi Code:

- id: `kimi-code`
- base URL: `https://api.kimi.com/coding/v1`
- endpoint format: OpenAI Chat Completions
- initial model: `kimi-for-coding`
- role: Kimi coding subscription provider added from Settings > Providers only

Moonshot CN:

- id: `moonshot-cn`
- base URL: `https://api.moonshot.cn/v1`
- endpoint format: OpenAI Chat Completions
- initial models: `kimi-k2.7-code`, `kimi-k2.6`, `kimi-k2.5`,
  `moonshot-v1-128k`, `moonshot-v1-32k`, `moonshot-v1-8k`
- model profile note: Kimi K2 models are marked as text+image chat models;
  video input is not represented in the current provider schema
- role: Moonshot open-platform provider added from Settings > Providers only

Moonshot Global:

- id: `moonshot-global`
- base URL: `https://api.moonshot.ai/v1`
- endpoint format: OpenAI Chat Completions
- initial models: `kimi-k2.7-code`, `kimi-k2.6`, `kimi-k2.5`,
  `moonshot-v1-128k`, `moonshot-v1-32k`, `moonshot-v1-8k`
- model profile note: Kimi K2 models are marked as text+image chat models;
  video input is not represented in the current provider schema
- role: international Moonshot open-platform provider added from Settings >
  Providers only

The defaults are not locked. Users can edit base URLs, protocols, and model IDs
if provider endpoints change, and they can add custom compatible providers at
any time.

First-run setup intentionally remains focused on the default stack. It only
shows DeepSeek plus the Xiaomi and MiniMax presets; Vercel AI Gateway, LiteLLM,
Zhipu, Z.ai, Kimi Code, and Moonshot presets are opt-in from Settings >
Providers.
