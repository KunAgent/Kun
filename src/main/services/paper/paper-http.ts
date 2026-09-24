/**
 * Shared HTTP layer for paper services: fixed UA, timeouts, AbortSignal
 * support, response-size caps, and an https-only host allowlist. Reuses the
 * app-level proxy transport (`fetchWithOptionalProxy`) so corporate-network
 * users get the same proxy behavior as model requests.
 */
import { app } from 'electron'
import { fetchWithOptionalProxy } from '../../proxy-fetch'

const PAPER_ALLOWED_HOSTS = new Set([
  'papers.cool',
  'www.papers.cool',
  'arxiv.org',
  'export.arxiv.org',
  'rss.arxiv.org',
  'api.semanticscholar.org',
  'api.crossref.org'
])

export const PAPER_HTML_MAX_BYTES = 5 * 1024 * 1024
export const PAPER_PDF_MAX_BYTES = 80 * 1024 * 1024
export const PAPER_EPRINT_MAX_BYTES = 150 * 1024 * 1024

export type PaperFetchErrorCode =
  | 'invalid-url'
  | 'network'
  | 'timeout'
  | 'canceled'
  | 'http'
  | 'too-large'
  | 'not-pdf'

export class PaperFetchError extends Error {
  constructor(
    readonly code: PaperFetchErrorCode,
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'PaperFetchError'
  }
}

export type PaperFetchOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  maxBytes?: number
  /** Metadata-declared PDF URLs may live on publisher hosts we do not list. */
  allowAnyHost?: boolean
  proxyUrl?: string
  /** When true the body must start with the `%PDF-` magic. */
  expectPdf?: boolean
}

function userAgent(): string {
  let version = 'dev'
  try {
    version = app.getVersion()
  } catch {
    // Non-Electron test contexts have no `app`.
  }
  return `Kun/${version} (+https://github.com/KunAgent/Kun)`
}

function assertAllowedUrl(raw: string, allowAnyHost: boolean): URL {
  let target: URL
  try {
    target = new URL(raw)
  } catch {
    throw new PaperFetchError('invalid-url', `Invalid URL: ${raw.slice(0, 200)}`)
  }
  if (target.protocol !== 'https:') {
    throw new PaperFetchError('invalid-url', `Only https URLs are allowed: ${target.host}`)
  }
  if (!allowAnyHost && !PAPER_ALLOWED_HOSTS.has(target.hostname.toLowerCase())) {
    throw new PaperFetchError('invalid-url', `Host is not allowed for paper fetches: ${target.hostname}`)
  }
  return target
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function mapFetchError(error: unknown, signal: AbortSignal | undefined, timeoutMs: number): PaperFetchError {
  if (signal?.aborted) {
    return new PaperFetchError('canceled', 'Request canceled.')
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new PaperFetchError('timeout', `Request timed out after ${Math.round(timeoutMs / 1000)}s.`)
  }
  if (error instanceof PaperFetchError) return error
  return new PaperFetchError('network', error instanceof Error ? error.message : String(error))
}

async function paperFetch(raw: string, options: PaperFetchOptions): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 60_000
  assertAllowedUrl(raw, options.allowAnyHost ?? false)
  const signal = combineSignals(options.signal, timeoutMs)
  try {
    const response = await fetchWithOptionalProxy(
      raw,
      {
        headers: { 'user-agent': userAgent() },
        redirect: 'follow',
        signal
      },
      options.proxyUrl ?? ''
    )
    if (!response.ok) {
      throw new PaperFetchError('http', `HTTP ${response.status} for ${new URL(raw).host}`, response.status)
    }
    return response
  } catch (error) {
    throw mapFetchError(error, options.signal, timeoutMs)
  }
}

async function readBoundedBody(response: Response, maxBytes: number, signal: AbortSignal | undefined): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > maxBytes) {
    throw new PaperFetchError('too-large', `Response exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB cap.`)
  }
  const chunks: Buffer[] = []
  let received = 0
  const reader = response.body?.getReader()
  if (!reader) {
    const buf = Buffer.from(await response.arrayBuffer())
    if (buf.length > maxBytes) {
      throw new PaperFetchError('too-large', `Response exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB cap.`)
    }
    return buf
  }
  try {
    for (;;) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined)
        throw new PaperFetchError('canceled', 'Request canceled.')
      }
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.length) continue
      received += value.byteLength
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new PaperFetchError('too-large', `Response exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB cap.`)
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, received)
}

export async function paperFetchText(url: string, options: PaperFetchOptions = {}): Promise<string> {
  const response = await paperFetch(url, options)
  const body = await readBoundedBody(response, options.maxBytes ?? PAPER_HTML_MAX_BYTES, options.signal)
  return body.toString('utf8')
}

export async function paperFetchBytes(url: string, options: PaperFetchOptions = {}): Promise<Buffer> {
  const response = await paperFetch(url, options)
  const body = await readBoundedBody(response, options.maxBytes ?? PAPER_PDF_MAX_BYTES, options.signal)
  if (options.expectPdf && !body.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii'))) {
    throw new PaperFetchError('not-pdf', 'Downloaded content is not a PDF document.')
  }
  return body
}
