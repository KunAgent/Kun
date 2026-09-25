export const MODEL_ENDPOINT_FORMATS = ['chat_completions', 'responses', 'messages', 'custom_endpoint'] as const
export type ModelEndpointFormat = (typeof MODEL_ENDPOINT_FORMATS)[number]
export const DEFAULT_MODEL_ENDPOINT_FORMAT: ModelEndpointFormat = 'chat_completions'

export function normalizeModelEndpointFormat(value: unknown): ModelEndpointFormat {
  if (typeof value !== 'string') return DEFAULT_MODEL_ENDPOINT_FORMAT
  const normalized = value.trim().toLowerCase().replace(/^\/+/, '')
  switch (normalized) {
    case 'chat':
    case 'chat-completions':
    case 'chat_completions':
    case 'v1/chat/completions':
    case 'chat/completions':
    case '/v1/chat/completions':
      return 'chat_completions'
    case 'custom':
    case 'custom-endpoint':
    case 'custom_endpoint':
    case 'custom-full-path':
    case 'custom_full_path':
    case 'full-path':
    case 'full_path':
    case 'full-url':
    case 'full_url':
      return 'custom_endpoint'
    case 'response':
    case 'responses':
    case 'v1/responses':
    case '/v1/responses':
      return 'responses'
    case 'message':
    case 'messages':
    case 'v1/messages':
    case '/v1/messages':
      return 'messages'
    default:
      return DEFAULT_MODEL_ENDPOINT_FORMAT
  }
}

export function modelEndpointPath(format: ModelEndpointFormat): string {
  switch (format) {
    case 'responses':
      return 'responses'
    case 'messages':
      return 'messages'
    case 'custom_endpoint':
    case 'chat_completions':
    default:
      return 'chat/completions'
  }
}

export function isCustomModelEndpointFormat(format: ModelEndpointFormat): boolean {
  return format === 'custom_endpoint'
}

export function usesChatCompletionsShape(format: ModelEndpointFormat): boolean {
  return format === 'chat_completions'
}

export function inferModelEndpointFormatFromUrl(url: string): ModelEndpointFormat | null {
  const query = url.search(/[?#]/)
  const path = (query < 0 ? url : url.slice(0, query)).trim().replace(/\/+$/, '').toLowerCase()
  if (path.endsWith('/chat/completions') || path.endsWith('/completions')) return 'chat_completions'
  if (path.endsWith('/responses')) return 'responses'
  if (path.endsWith('/messages')) return 'messages'
  return null
}

export function resolveModelEndpointFormat(
  endpointFormat: ModelEndpointFormat,
  baseUrl: string
): ModelEndpointFormat | null {
  return isCustomModelEndpointFormat(endpointFormat)
    ? inferModelEndpointFormatFromUrl(baseUrl)
    : endpointFormat
}

const MODEL_ENDPOINT_VERSION_SEGMENT = /^v\d+(?:alpha|beta)?\d*$/i
const MODEL_ENDPOINT_KNOWN_SUFFIXES = ['chat/completions', 'responses', 'messages'] as const

function splitModelEndpointUrlTail(url: string): { path: string; tail: string } {
  const query = url.search(/[?#]/)
  return query < 0
    ? { path: url, tail: '' }
    : { path: url.slice(0, query), tail: url.slice(query) }
}

function trimModelEndpointUrl(url: string): string {
  const { path, tail } = splitModelEndpointUrlTail(url.trim())
  return `${path.replace(/\/+$/, '')}${tail}`
}

function modelEndpointSegments(url: string): string[] {
  const { path } = splitModelEndpointUrlTail(url.trim())
  return path.replace(/\/+$/, '').split('/').filter(Boolean)
}

function isCodexModelEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === 'https:' &&
      parsed.hostname === 'chatgpt.com' &&
      parsed.pathname.replace(/\/+$/, '').startsWith('/backend-api/codex')
  } catch {
    return false
  }
}

/**
 * The single URL builder every model consumer shares (chat loop, probes,
 * inline completion, scheduled-task detection). Rules:
 *
 * - `custom_endpoint` returns the explicit URL untouched for `generate`;
 *   it has no discoverable models URL.
 * - Codex subscription endpoints always target `/backend-api/codex/responses`.
 * - A path that already ends with the resolved suffix is returned as-is.
 * - Any path segment matching `vN[alpha|beta]M` (e.g. `v1`, `v4`, `v1beta`)
 *   means the URL is already versioned, so the suffix appends directly —
 *   `.../v1beta/openai` + `chat/completions`, not `.../v1beta/openai/v1/...`.
 * - A trailing `beta` segment (DeepSeek) upgrades to `v1`.
 * - Otherwise `/v1/<suffix>` is appended.
 */
export function resolveModelEndpointUrl(
  baseUrl: string,
  format: ModelEndpointFormat,
  target: 'generate' | 'models' = 'generate'
): string {
  if (isCustomModelEndpointFormat(format)) {
    if (target === 'models') {
      throw new Error(
        'custom_endpoint does not define a models URL; configure models explicitly with probe disabled'
      )
    }
    return trimModelEndpointUrl(baseUrl)
  }
  if (isCodexModelEndpoint(baseUrl)) {
    const trimmed = trimModelEndpointUrl(baseUrl)
    if (target === 'models') {
      try {
        const parsed = new URL(trimmed)
        parsed.pathname = '/backend-api/codex/models'
        parsed.search = ''
        parsed.hash = ''
        return parsed.toString()
      } catch {
        return 'https://chatgpt.com/backend-api/codex/models'
      }
    }
    try {
      const parsed = new URL(trimmed)
      parsed.pathname = '/backend-api/codex/responses'
      parsed.search = ''
      parsed.hash = ''
      return parsed.toString()
    } catch {
      return 'https://chatgpt.com/backend-api/codex/responses'
    }
  }
  const suffix = target === 'models' ? 'models' : modelEndpointPath(format)
  const { path, tail } = splitModelEndpointUrlTail(baseUrl.trim())
  const normalized = path.replace(/\/+$/, '')
  if (!normalized) return `/v1/${suffix}${tail}`
  if (normalized.toLowerCase().endsWith(`/${suffix}`)) return `${normalized}${tail}`
  // A configured full endpoint path renormalizes to its base (relay gateways
  // hand out e.g. `.../anthropic/v1/messages` as the provider base URL).
  let stripped = normalized
  const lower = normalized.toLowerCase()
  for (const known of MODEL_ENDPOINT_KNOWN_SUFFIXES) {
    if (lower.endsWith(`/${known}`)) {
      stripped = normalized.slice(0, -(known.length + 1)).replace(/\/+$/, '')
      break
    }
  }
  if (!stripped) return `/v1/${suffix}${tail}`
  const lastSlash = stripped.lastIndexOf('/')
  const lastSegment = lastSlash < 0 ? stripped.toLowerCase() : stripped.slice(lastSlash + 1).toLowerCase()
  const versionedBase = lastSegment === 'beta'
    ? `${stripped.slice(0, lastSlash < 0 ? 0 : lastSlash)}/v1`
    : stripped
  const versioned = modelEndpointSegments(versionedBase)
    .some((segment) => MODEL_ENDPOINT_VERSION_SEGMENT.test(segment))
  return `${versionedBase}${versioned ? '' : '/v1'}/${suffix}${tail}`
}
