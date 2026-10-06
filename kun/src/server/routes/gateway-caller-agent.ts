/**
 * Which agent sent a gateway request, for usage attribution only.
 *
 * A client may prefix its real gateway key with `kun-<app>.` (for example
 * `kun-claude-code.kun_local_…`): the prefix names the app, the remainder is
 * the credential that is actually verified. Without the prefix, an explicit
 * `x-kun-agent` header or the first User-Agent product names it. Attribution
 * never grants access; the stripped secret alone authenticates.
 */
const ATTRIBUTED_KEY = /^kun-([a-z0-9][a-z0-9_-]{0,31})\.(\S+)$/
const AGENT_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** User-Agent products that name a known agent differently from its common id. */
const USER_AGENT_ALIASES: Record<string, string> = {
  'claude-cli': 'claude-code',
  'claude-code': 'claude-code',
  codex_cli_rs: 'codex',
  'codex-cli': 'codex',
  codex_exec: 'codex',
  opencode: 'opencode',
  'pi-coding-agent': 'pi',
  'gemini-cli': 'gemini-cli',
  geminicli: 'gemini-cli',
  crush: 'crush',
  goose: 'goose',
  'cline': 'cline',
  'kilo-code': 'kilo-code',
  'roo-code': 'roo-code',
  droid: 'droid',
  factory: 'droid'
}

export function splitAttributedKey(candidate: string | null): { secret: string | null; agent?: string } {
  if (!candidate) return { secret: null }
  const match = ATTRIBUTED_KEY.exec(candidate)
  return match ? { secret: match[2]!, agent: match[1]! } : { secret: candidate }
}

function normalizedAgent(value: string | null | undefined): string | undefined {
  const name = value?.trim().toLowerCase()
  return name && AGENT_NAME.test(name) ? USER_AGENT_ALIASES[name] ?? name : undefined
}

/** First product token of a User-Agent: `claude-cli/2.1.0 (external, cli)` → `claude-cli`. */
export function userAgentProduct(userAgent: string | null): string | undefined {
  const token = userAgent?.trim().split(/\s+/, 1)[0]?.split('/', 1)[0]
  return normalizedAgent(token)
}

export function rawGatewayCredential(request: Request): string | null {
  const header = request.headers.get('authorization')
  const match = /^Bearer ([^\s]+)$/.exec(header ?? '')
  const candidate = match?.[1] ?? request.headers.get('x-api-key')
  return candidate && candidate.trim() ? candidate : null
}

export function gatewayCallerAgent(request: Request): string | undefined {
  return splitAttributedKey(rawGatewayCredential(request)).agent ??
    normalizedAgent(request.headers.get('x-kun-agent')) ??
    userAgentProduct(request.headers.get('user-agent'))
}
