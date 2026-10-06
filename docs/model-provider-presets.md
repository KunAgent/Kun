# Model Provider Presets

See [provider configuration and gateway](provider-configuration-and-gateway.md)
for the current Registry, account discovery, transactions and execution contract.

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

Preset providers remain opt-in. Each account can be paused independently, and
group defaults can disable its new requests without deleting credentials or
model selections. Adding every known provider by default would expose choices
before the user has configured their accounts.

The 43 packaged descriptors live under
`packages/provider-catalog/src/definitions/`. Add ordinary compatible vendors
there and validate them through the catalog package. Runtime adapters stay in
Kun; a JSON descriptor cannot add executable authentication or protocol code.

## Built-in Providers

ChatGPT subscription:

- Model discovery uses the provider's own OAuth credential and HTTP catalog.
  It does not require, launch, install, or read credentials from a Codex Agent.
- Before discovery, public `@openai/codex` release metadata supplies the catalog
  compatibility version. Successful version checks are cached in memory for
  24 hours per transport/proxy; failed checks retry after five minutes and keep
  the last working version or the bundled minimum. URL and User-Agent use the
  same version. No provider credentials are sent to the package registry.
- A rejected version or malformed catalog retries the last working version.
  Authentication errors, rate limits, server errors, and valid empty account
  catalogs remain authoritative. Catalog enrichment cannot add unavailable models.
- Agent executable updates and native Agent model discovery remain separate
  harness operations; updating a provider catalog never updates an Agent.

Opper:

- id: `opper`
- base URL: `https://api.opper.ai/v3/compat`
- endpoint format: OpenAI Chat Completions
- models: imported on demand from the gateway `GET /models` endpoint
- model ids: a bare pool name such as `claude-sonnet-4-6` routes across every
  provider serving that model; `<provider>/<model>` such as
  `aws/claude-sonnet-4-6-eu` pins one provider or region
- role: optional EU-hosted multi-provider gateway (Opper Technology AB,
  Stockholm) billing each upstream provider's own token rates with no markup
- behavior: direct providers remain the default; adding this preset does not
  route existing providers through Opper

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

Kimi coding subscription:

- base URL: `https://api.kimi.com/coding/v1`
- endpoint format: OpenAI Chat Completions
- initial model: `kimi-for-coding`
- role: optional Kimi coding subscription provider added from Settings > Providers only

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
Zhipu, Z.ai, additional coding subscriptions, and Moonshot presets are opt-in
from Settings > Providers. These catalog entries stay out of the default
first-run screen so setup remains focused.
