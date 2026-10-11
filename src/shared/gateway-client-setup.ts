import { codexConfig, opencodeConfig, piModelsConfig } from '../../kun/src/harness/gateway-config-templates'

export const GATEWAY_CLIENTS = [
  { id: 'codex', label: 'Codex', protocol: 'OpenAI Responses' },
  { id: 'claude-code', label: 'Claude Code', protocol: 'Anthropic Messages' },
  { id: 'opencode', label: 'OpenCode', protocol: 'OpenAI Chat Completions' },
  { id: 'pi', label: 'Pi', protocol: 'OpenAI Chat Completions' }
] as const
export type GatewayClientId = typeof GATEWAY_CLIENTS[number]['id']
export const GATEWAY_KEY_ENV = 'KUN_GATEWAY_API_KEY'

/** Public gateway clients receive an alias and their own key, never upstream credentials. */
export type GatewayClientSetupPreview = {
  clientId: GatewayClientId
  fileName?: string
  content?: string
  launch: string
  baseUrl: string
  modelId: string
}
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

export function gatewayV1BaseUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash || !['', '/', '/v1', '/v1/'].includes(url.pathname)) {
    throw new Error('Gateway setup requires an HTTP loopback address')
  }
  return `${url.origin}/v1`
}

export function buildGatewayClientSetup(clientId: GatewayClientId, baseUrl: string, modelId: string): GatewayClientSetupPreview {
  const v1 = gatewayV1BaseUrl(baseUrl)
  if (!modelId.trim() || modelId.length > 512 || [...modelId].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('Select a public route alias')
  const common = { clientId, baseUrl: v1, modelId }
  switch (clientId) {
    case 'codex': return { ...common, fileName: '.kun-gateway/codex/config.toml',
      content: codexConfig(v1, modelId, GATEWAY_KEY_ENV),
      launch: 'CODEX_HOME="$PWD/.kun-gateway/codex" codex' }
    case 'opencode': return { ...common, fileName: '.kun-gateway/opencode/opencode.json',
      content: opencodeConfig(v1, modelId, GATEWAY_KEY_ENV),
      launch: 'OPENCODE_CONFIG="$PWD/.kun-gateway/opencode/opencode.json" opencode' }
    case 'pi': return { ...common, fileName: '.kun-gateway/pi/models.json',
      content: piModelsConfig(v1, modelId, GATEWAY_KEY_ENV),
      launch: `PI_CODING_AGENT_DIR="$PWD/.kun-gateway/pi" pi --provider kun --model ${shellQuote(modelId)}` }
    case 'claude-code': return { ...common,
      launch: `env -u ANTHROPIC_API_KEY -u CLAUDE_CODE_OAUTH_TOKEN -u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX -u CLAUDE_CODE_USE_FOUNDRY \\\n  ANTHROPIC_BASE_URL=${shellQuote(v1.replace(/\/v1$/, ''))} \\\n  ANTHROPIC_AUTH_TOKEN="kun-claude-code.$KUN_GATEWAY_API_KEY" \\\n  ANTHROPIC_MODEL=${shellQuote(modelId)} \\\n  ANTHROPIC_DEFAULT_OPUS_MODEL=${shellQuote(modelId)} \\\n  ANTHROPIC_DEFAULT_SONNET_MODEL=${shellQuote(modelId)} \\\n  ANTHROPIC_DEFAULT_HAIKU_MODEL=${shellQuote(modelId)} \\\n  ANTHROPIC_SMALL_FAST_MODEL=${shellQuote(modelId)} claude` }
  }
}

/** Deliberately returns only a redacted, reviewable addition; never reads or edits user files. */
export function gatewaySetupDiff(preview: GatewayClientSetupPreview): string {
  return [`--- /dev/null`, `+++ ${preview.fileName ?? 'launch environment (session only)'}`,
    ...(preview.content ?? preview.launch).trimEnd().split('\n').map((line) => `+${line}`)].join('\n')
}
