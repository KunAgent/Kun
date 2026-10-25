/**
 * Local Magpie gateway import. `magpie-kun` is a public usage label, never a
 * vendor credential. The link cannot name a remote host, a secret, or a
 * launch option.
 */
export const MAGPIE_TOKEN = 'magpie-kun'
export const MAGPIE_PROVIDER_ID = 'magpie'
export const MAGPIE_USER_AGENT = 'Kun'
export const MAGPIE_IMPORT_MAX_LENGTH = 8192
/**
 * Never end a main-bundle string with the word "import" before its quote:
 * electron-vite's ESM shim regex reads it as an import statement and splices
 * its CommonJS shim into the next string literal, breaking the main build.
 */
export const MAGPIE_IMPORT_INVALID = 'Invalid Magpie import link'

const MAGPIE_PROTOCOLS = ['openai-chat', 'openai-responses', 'anthropic-messages'] as const
export type MagpieProtocol = (typeof MAGPIE_PROTOCOLS)[number]
export type MagpieImport = { gatewayUrl: string; protocols: MagpieProtocol[] }

export type MagpieConnection = {
  baseUrl: string
  endpointFormat: 'chat_completions' | 'responses' | 'messages'
  chatBaseUrl?: string
  anthropicBaseUrl?: string
  responsesBaseUrl?: string
}

/** Import never authorizes arbitrary hosts, paths, credentials, or launch fields. */
export function normalizeMagpieGateway(value: string): string {
  if (value.length > 256) throw new Error('Invalid Magpie gateway')
  const url = new URL(value)
  if (
    !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::[0-9]+)?\/?$/.test(value) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Magpie requires a local HTTP gateway')
  }
  return url.origin
}

export function isMagpieProviderImportLink(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'kun:' &&
      url.hostname === 'provider' &&
      url.pathname.replace(/\/+$/, '').toLowerCase() === '/import'
  } catch {
    return false
  }
}

function decodeBase64Url(data: string): string {
  const padded = data + '='.repeat((4 - (data.length % 4)) % 4)
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder('utf-8', { fatal: true }).decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0))
  )
}

/** Versioned local envelope. Only the fixed public Magpie token is accepted. */
export function parseMagpieImportLink(value: string): MagpieImport {
  const trimmed = value.trim()
  if (trimmed.length > MAGPIE_IMPORT_MAX_LENGTH || !isMagpieProviderImportLink(trimmed)) {
    throw new Error(MAGPIE_IMPORT_INVALID)
  }
  const url = new URL(trimmed)
  if (
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    [...url.searchParams.keys()].some((key) => key !== 'v' && key !== 'data') ||
    url.searchParams.getAll('v').length !== 1 ||
    url.searchParams.get('v') !== '1' ||
    url.searchParams.getAll('data').length !== 1
  ) {
    throw new Error(MAGPIE_IMPORT_INVALID)
  }
  const data = url.searchParams.get('data') ?? ''
  if (!/^[A-Za-z0-9_-]+$/.test(data)) throw new Error(MAGPIE_IMPORT_INVALID)
  let raw: unknown
  try {
    raw = JSON.parse(decodeBase64Url(data))
  } catch {
    throw new Error(MAGPIE_IMPORT_INVALID)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(MAGPIE_IMPORT_INVALID)
  const payload = raw as Record<string, unknown>
  if (
    Object.keys(payload).some((key) => !['kind', 'id', 'name', 'auth', 'endpoints'].includes(key)) ||
    payload.kind !== 'custom' ||
    payload.id !== 'magpie' ||
    payload.name !== 'Magpie'
  ) {
    throw new Error('Invalid Magpie provider')
  }
  const auth = payload.auth
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) throw new Error('Invalid Magpie token')
  const authRecord = auth as Record<string, unknown>
  if (
    Object.keys(authRecord).length !== 2 ||
    authRecord.method !== 'apiKey' ||
    authRecord.apiKey !== MAGPIE_TOKEN
  ) {
    throw new Error('Invalid Magpie token')
  }
  if (!Array.isArray(payload.endpoints) || !payload.endpoints.length || payload.endpoints.length > 3) {
    throw new Error('Invalid Magpie endpoints')
  }
  let gatewayUrl: string | undefined
  const protocols: MagpieProtocol[] = []
  for (const rawEndpoint of payload.endpoints) {
    if (!rawEndpoint || typeof rawEndpoint !== 'object' || Array.isArray(rawEndpoint)) {
      throw new Error('Invalid Magpie endpoint')
    }
    const endpoint = rawEndpoint as Record<string, unknown>
    if (
      Object.keys(endpoint).some((key) => !['protocol', 'baseUrl', 'targets', 'modelsUrl'].includes(key)) ||
      typeof endpoint.baseUrl !== 'string' ||
      !Array.isArray(endpoint.targets) ||
      endpoint.targets.length !== 1 ||
      endpoint.targets[0] !== 'kun'
    ) {
      throw new Error('Invalid Magpie endpoint')
    }
    const protocol = endpoint.protocol
    if (protocol !== 'anthropic-messages' && protocol !== 'openai-responses' && protocol !== 'openai-chat') {
      throw new Error('Invalid Magpie protocol')
    }
    if (protocols.includes(protocol)) throw new Error('Invalid Magpie endpoint')
    const base = endpoint.baseUrl
    const anthropic = protocol === 'anthropic-messages'
    if (!anthropic && !base.endsWith('/v1')) throw new Error('Invalid Magpie API path')
    const gateway = normalizeMagpieGateway(anthropic ? base : base.slice(0, -3))
    if ((gatewayUrl && gatewayUrl !== gateway) || endpoint.modelsUrl !== `${gateway}/v1/models`) {
      throw new Error('Magpie endpoints must use the same local gateway')
    }
    gatewayUrl = gateway
    protocols.push(protocol)
  }
  if (!gatewayUrl) throw new Error('Missing Magpie gateway')
  return {
    gatewayUrl,
    protocols: MAGPIE_PROTOCOLS.filter((protocol) => protocols.includes(protocol))
  }
}

/** Chat and Responses use `{origin}/v1`; Anthropic Messages uses the origin. */
export function magpieConnection(parsed: MagpieImport): MagpieConnection {
  const gateway = normalizeMagpieGateway(parsed.gatewayUrl)
  const chat = parsed.protocols.includes('openai-chat')
  const responses = parsed.protocols.includes('openai-responses')
  const anthropic = parsed.protocols.includes('anthropic-messages')
  return {
    baseUrl: chat || responses ? `${gateway}/v1` : gateway,
    endpointFormat: chat ? 'chat_completions' : responses ? 'responses' : 'messages',
    ...(chat ? { chatBaseUrl: `${gateway}/v1` } : {}),
    ...(responses ? { responsesBaseUrl: `${gateway}/v1` } : {}),
    ...(anthropic ? { anthropicBaseUrl: gateway } : {})
  }
}

/** Set only when this request's key is the public Magpie label and no User-Agent was chosen. */
export function magpieAttributionUserAgent(
  apiKey: string,
  headers: Record<string, string>
): string | undefined {
  if (apiKey !== MAGPIE_TOKEN) return undefined
  if (Object.keys(headers).some((name) => name.toLowerCase() === 'user-agent')) return undefined
  return MAGPIE_USER_AGENT
}
