import {
  FigmaError,
  FIGMA_API_ORIGIN,
  FIGMA_MAX_RESPONSE_BYTES,
  FIGMA_MAX_RETRY_AFTER_MS,
  FIGMA_REQUEST_TIMEOUT_MS
} from './ports.js'

const FILE_PATH = /^\/v1\/files\/[A-Za-z0-9]{10,64}$/u
const NODES_PATH = /^\/v1\/files\/[A-Za-z0-9]{10,64}\/nodes$/u
const IMAGES_PATH = /^\/v1\/images\/[A-Za-z0-9]{10,64}$/u
/** Printable ASCII only: rejects CR/LF and other header-splitting input. */
const TOKEN_PATTERN = /^[\x21-\x7E]{1,512}$/u

/**
 * Defense in depth: request builders only ever produce the three read paths on
 * the fixed origin, and this fence rejects everything else before the wire.
 */
export function assertFigmaDestination(input: string | URL): URL {
  let url: URL
  try {
    url = new URL(typeof input === 'string' ? input : input.href)
  } catch {
    throw new FigmaError('invalid_input', 'Figma requests must target the fixed Figma API endpoint.')
  }
  const allowed = FILE_PATH.test(url.pathname) || NODES_PATH.test(url.pathname) || IMAGES_PATH.test(url.pathname)
  if (url.protocol !== 'https:' || url.origin !== FIGMA_API_ORIGIN || !allowed || url.username || url.password || url.hash) {
    throw new FigmaError('invalid_input', 'Figma requests must target the fixed Figma API endpoint.')
  }
  return url
}

export function assertFigmaToken(token: string | undefined): string {
  const value = (token ?? '').trim()
  if (!value) throw new FigmaError('credential_missing', 'Connect Figma with a personal access token to continue.')
  if (!TOKEN_PATTERN.test(value)) {
    throw new FigmaError('credential_invalid', 'The stored Figma token is not usable. Reconnect Figma.')
  }
  return value
}

export type FigmaTransportOptions = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxBytes?: number
}

/**
 * One GET per call: no retries, no redirects, no proxy of arbitrary URLs. The
 * bearer token only ever travels in the `X-Figma-Token` request header.
 */
export class FigmaRestTransport {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly maxBytes: number

  constructor(options: FigmaTransportOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? FIGMA_REQUEST_TIMEOUT_MS
    this.maxBytes = options.maxBytes ?? FIGMA_MAX_RESPONSE_BYTES
  }

  async getJson(input: { path: string; params?: URLSearchParams; token: string }): Promise<unknown> {
    const token = assertFigmaToken(input.token)
    const query = input.params?.toString() ?? ''
    const url = assertFigmaDestination(`${FIGMA_API_ORIGIN}${input.path}${query ? `?${query}` : ''}`)
    let response: Response
    try {
      response = await this.fetchImpl(url.href, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { 'X-Figma-Token': token, accept: 'application/json' }
      })
    } catch {
      throw new FigmaError('upstream_unavailable', 'Figma could not be reached. Try again later.')
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw this.failure(response)
    }
    return await readBoundedJson(response, this.maxBytes)
  }

  private failure(response: Response): FigmaError {
    const status = response.status
    if (status === 400) {
      return new FigmaError('invalid_input', 'Figma rejected this request. Check the file link and node ids.')
    }
    if (status === 403) {
      return new FigmaError('access_denied', 'This Figma token cannot read that file. Check its file access.')
    }
    if (status === 404) {
      return new FigmaError('not_found', 'That Figma file or node was not found, or this token cannot see it.')
    }
    if (status === 429) {
      return new FigmaError('rate_limited', 'Figma is rate limiting Kun. Try again shortly.',
        retryAfterMs(response.headers.get('retry-after')))
    }
    return new FigmaError('upstream_unavailable', 'Figma could not complete this request. Try again later.')
  }
}

function retryAfterMs(header: string | null): number | undefined {
  const raw = header?.trim()
  if (!raw) return undefined
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds < 0) return undefined
  return Math.min(Math.round(seconds * 1_000), FIGMA_MAX_RETRY_AFTER_MS)
}

async function readBoundedJson(response: Response, limit: number): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined)
    throw new FigmaError('response_too_large', 'That Figma response is too large to read safely in Kun.')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new FigmaError('invalid_response', 'Figma returned an incomplete response.')
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.length
      if (bytes > limit) throw new FigmaError('response_too_large', 'That Figma response is too large to read safely in Kun.')
      chunks.push(next.value)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new FigmaError('invalid_response', 'Figma returned an incomplete response.')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new FigmaError('invalid_response', 'Figma returned an incomplete response.')
    }
    return parsed
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    if (error instanceof FigmaError) throw error
    throw new FigmaError('invalid_response', 'Figma returned an incomplete response.')
  } finally {
    reader.releaseLock()
  }
}
