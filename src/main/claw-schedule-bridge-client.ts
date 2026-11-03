/**
 * HTTP client for the workflow/schedule bridge hosted by the Electron main
 * process. It exists separately from the MCP server so its failure
 * classification can be tested without spawning a stdio server.
 */

export type BridgeEndpoint = {
  baseUrl: string
  secret: string
}

export type BridgeFailureCode = 'connect' | 'http' | 'timeout' | 'cancelled'

/** Failure shaped so the tool text alone can explain what actually went wrong. */
export class WorkflowBridgeError extends Error {
  readonly code: BridgeFailureCode
  readonly status: number | undefined

  constructor(
    code: BridgeFailureCode,
    message: string,
    options: { status?: number; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'WorkflowBridgeError'
    this.code = code
    this.status = options.status
  }
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const MAX_HTTP_DETAIL_CHARS = 300

function errorCode(value: unknown): string {
  const code = (value as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' ? code : ''
}

/**
 * undici collapses every TCP/TLS failure into `TypeError: fetch failed`; the
 * useful errno (ECONNREFUSED, EHOSTUNREACH, ...) only lives on `cause`.
 */
function describeCause(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const nested = (error as { cause?: unknown }).cause
  const code = errorCode(error) || errorCode(nested)
  if (code) return code
  if (nested instanceof Error && nested.message) return nested.message
  if (typeof nested === 'string' && nested) return nested
  return error.message
}

function httpDetail(parsed: Record<string, unknown>): string {
  const candidate =
    (typeof parsed.message === 'string' && parsed.message.trim()) ||
    (typeof parsed.error === 'string' && parsed.error.trim()) ||
    'no error message'
  return candidate.slice(0, MAX_HTTP_DETAIL_CHARS)
}

/**
 * POST a JSON body to the local bridge.
 *
 * The endpoint secret only ever travels in the Authorization header, so the
 * reported URL is safe to surface to the agent and to logs.
 */
export async function postJson(
  endpoint: BridgeEndpoint,
  path: string,
  body: Record<string, unknown>,
  request: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<Record<string, unknown>> {
  const url = `${endpoint.baseUrl}${path}`
  const timeoutMs = request.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (endpoint.secret) {
    headers.Authorization = `Bearer ${endpoint.secret}`
  }

  let response: Response
  try {
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
  } catch (error) {
    if (request.signal?.aborted) {
      throw new WorkflowBridgeError('cancelled', `POST ${url} was cancelled before it completed`, {
        cause: error
      })
    }
    if (timeoutSignal.aborted) {
      throw new WorkflowBridgeError(
        'timeout',
        `POST ${url} received no response within ${timeoutMs}ms`,
        { cause: error }
      )
    }
    throw new WorkflowBridgeError(
      'connect',
      `POST ${url} could not reach the local Kun bridge (${describeCause(error)})`,
      { cause: error }
    )
  }

  const text = await response.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    parsed = text.trim() ? { message: text.trim() } : {}
  }
  if (!response.ok) {
    throw new WorkflowBridgeError(
      'http',
      `POST ${url} failed with HTTP ${response.status}: ${httpDetail(parsed)}`,
      { status: response.status }
    )
  }
  return parsed
}
