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

/**
 * Bearer, `x-api-key` (Anthropic) and `x-goog-api-key` (Gemini) carry the key;
 * Gemini clients may also send `?key=` on `/v1beta` paths only.
 */
export function rawGatewayCredential(request: Request): string | null {
  const header = request.headers.get('authorization')
  const match = /^Bearer ([^\s]+)$/.exec(header ?? '')
  let candidate = match?.[1] ?? request.headers.get('x-api-key') ?? request.headers.get('x-goog-api-key')
  if (!candidate) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/v1beta/')) candidate = url.searchParams.get('key')
  }
  return candidate && candidate.trim() ? candidate : null
}

export function gatewayCallerAgent(request: Request): string | undefined {
  return splitAttributedKey(rawGatewayCredential(request)).agent ??
    normalizedAgent(request.headers.get('x-kun-agent')) ??
    userAgentProduct(request.headers.get('user-agent'))
}

const SESSION_TEXT = /^[A-Za-z0-9._-]{1,128}$/

/**
 * The calling agent's own session id, when it reveals one, as observed from
 * the agents themselves: Codex sends a `session-id` header (older builds
 * `session_id`) and `client_metadata.session_id`; Claude Code sends
 * `x-claude-code-session-id` and repeats it in `metadata.user_id` (a JSON
 * string); Kimi Code sends `prompt_cache_key: session_<id>`, and OpenCode,
 * which Kun configures with `setCacheKey`, `promptCacheKey: ses_<id>`;
 * Crush sends `x-session-id` and Goose `agent-session-id`. Droid, Gemini
 * CLI, Pi, Aider and Continue send none. Used only to group usage and route
 * traces; never for authorization.
 */
export function gatewaySessionHint(request: Request, body?: Record<string, unknown>): string | undefined {
  for (const name of ['session-id', 'session_id', 'x-claude-code-session-id', 'x-session-id', 'agent-session-id']) {
    const value = request.headers.get(name)?.trim()
    if (value && SESSION_TEXT.test(value)) return value
  }
  const clientMetadata = record(body?.client_metadata)?.session_id
  if (typeof clientMetadata === 'string' && SESSION_TEXT.test(clientMetadata)) return clientMetadata
  const userId = record(body?.metadata)?.user_id
  if (typeof userId === 'string' && userId.startsWith('{') && userId.length <= 4_096) {
    try {
      const session = (JSON.parse(userId) as { session_id?: unknown }).session_id
      if (typeof session === 'string' && SESSION_TEXT.test(session)) return session
    } catch { /* not the Claude Code shape */ }
  }
  // Cache keys are often per-prompt hashes; only the session-shaped ones these agents send count.
  for (const cacheKey of [body?.prompt_cache_key, body?.promptCacheKey]) {
    if (typeof cacheKey === 'string' && /^(?:session[_-]|ses_)/.test(cacheKey) && SESSION_TEXT.test(cacheKey)) return cacheKey
  }
  return undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
