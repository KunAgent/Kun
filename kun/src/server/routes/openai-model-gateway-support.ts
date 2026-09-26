import { jsonResponse, type JsonResponse } from '../response.js'
import { GatewayRequestGuard, type GatewayLease } from './gateway-request-guard.js'
import type { ServerRuntime } from './server-runtime.js'
import type { ModelStreamChunk } from '../../ports/model-client.js'

export const MAX_GATEWAY_BODY_BYTES = 2 * 1024 * 1024
const GATEWAY_GUARDS = new WeakMap<object, GatewayRequestGuard>()

export function guardFor(runtime: ServerRuntime): GatewayRequestGuard | null {
  const credentials = runtime.modelGateway?.credentials
  if (!credentials) return null
  let guard = GATEWAY_GUARDS.get(credentials)
  if (!guard) {
    guard = new GatewayRequestGuard(credentials)
    GATEWAY_GUARDS.set(credentials, guard)
  }
  return guard
}
export async function nextGatewayChunk(
  iterator: AsyncIterator<ModelStreamChunk>,
  signal: AbortSignal
): Promise<IteratorResult<ModelStreamChunk>> {
  if (signal.aborted) throw signal.reason ?? new Error('gateway request aborted')
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(signal.reason ?? new Error('gateway request aborted'))
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    iterator.next().then(
      (result) => { cleanup(); resolve(result) },
      (error) => { cleanup(); reject(error) }
    )
  })
}

export function authorizePublicGateway(runtime: ServerRuntime, request: Request): JsonResponse | null {
  const guard = guardFor(runtime)
  if (!guard || !guard.authorize(request)) return openAiError('Invalid gateway API key.', 'invalid_api_key', 401)
  if (!guard.consumeToken()) return openAiError('Gateway rate limit exceeded.', 'rate_limit_exceeded', 429)
  return null
}

export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
export function openAiError(message: string, code: string, status: number): JsonResponse {
  return jsonResponse({ error: { message, type: status >= 500 ? 'server_error' : 'invalid_request_error', param: null, code } }, status)
}
export function errorStatus(chunk: Extract<ModelStreamChunk, { kind: 'error' }>): number { return chunk.failure?.httpStatus && chunk.failure.httpStatus >= 400 ? chunk.failure.httpStatus : 502 }
export function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
export function stringValue(value: unknown): string { return typeof value === 'string' ? value : '' }
export function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
export function parseArguments(value: unknown): Record<string, unknown> { try { return typeof value === 'string' ? asRecord(JSON.parse(value)) : asRecord(value) } catch { return {} } }

