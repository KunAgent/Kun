export const OPENCODE_SESSION_HEADER = 'x-opencode-session'

export type OpenCodeProviderIdentity = {
  presetSource?: string
  providerId?: string
  baseUrl: string
}

/**
 * OpenCode Go (the subscription tier at opencode.ai/zen/go) requires a
 * per-session routing header (`x-opencode-session`) on every request. Identify
 * it from the stable preset source first, then from the exact host + path
 * boundary for manually configured official Go endpoints. Never use a loose
 * substring match: other `opencode.ai` paths such as `/zen/v1` must not be
 * misclassified as Go.
 */
export function isOpenCodeGo(input: OpenCodeProviderIdentity): boolean {
  if (input.presetSource === 'opencode-go') return true
  const providerId = input.providerId?.trim().toLowerCase() ?? ''
  // Multi-account preset ids resolve to presetSource 'opencode-go', but a
  // profile that lost that binding still keeps an `opencode-go[-N]` id.
  if (/^opencode-go(?:-[0-9]+)?$/u.test(providerId)) return true
  const path = officialOpenCodeZenPath(input.baseUrl)
  return path === '/zen/go' || Boolean(path?.startsWith('/zen/go/'))
}

export function requiresOpenCodeSessionHeader(input: OpenCodeProviderIdentity): boolean {
  return isOpenCodeGo(input)
}

/**
 * Resolve the per-session routing id for OpenCode Go. A real Kun thread
 * id is propagated as-is; a non-session probe/inline completion that carries
 * no thread id gets a stable, request-local routing id.
 */
export function resolveOpenCodeSessionId(threadId?: string): string {
  return threadId?.trim() || globalThis.crypto.randomUUID()
}

export function openCodeSessionRuntimeHeaders(
  input: OpenCodeProviderIdentity,
  threadId?: string
): Record<string, string> | undefined {
  if (!requiresOpenCodeSessionHeader(input)) return undefined
  return { [OPENCODE_SESSION_HEADER]: resolveOpenCodeSessionId(threadId) }
}

/** Adds OpenCode session identity without overriding an explicit header. */
export function withOpenCodeSessionHeader(
  input: OpenCodeProviderIdentity,
  sessionId: string | undefined,
  headers?: Record<string, string>
): Record<string, string> | undefined {
  const normalizedSessionId = sessionId?.trim()
  if (!requiresOpenCodeSessionHeader(input) || !normalizedSessionId) return headers
  if (Object.keys(headers ?? {}).some((name) => name.toLowerCase() === OPENCODE_SESSION_HEADER)) {
    return headers
  }
  return { ...headers, [OPENCODE_SESSION_HEADER]: normalizedSessionId }
}

function officialOpenCodeZenPath(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.trim())
    if (url.protocol !== 'https:' || url.hostname !== 'opencode.ai') return null
    return url.pathname.replace(/\/+$/u, '')
  } catch {
    return null
  }
}
