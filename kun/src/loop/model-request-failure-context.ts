import type { ModelRequestFailureContext } from '../contracts/model-request-failure.js'
import type { ModelFailureMetadata } from '../contracts/model-route-pool.js'
import type { ModelRequest } from '../ports/model-client.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { TurnExecutionFailure } from './turn-execution-types.js'
import { redactSecretText } from '../config/secret-redaction.js'

const PREFLIGHT_PATTERNS = [
  /unknown model provider:/i,
  /protected model credential is unavailable/i,
  /credential refresh failed/i,
  /model provider id is required/i
]

export function modelRequestFailureContext(input: {
  request: Pick<ModelRequest, 'providerId' | 'model'>
  failure?: ModelFailureMetadata
  code?: string
}): ModelRequestFailureContext | undefined {
  const failure = input.failure
  const preflightFailure = input.code === 'credential_refresh_failed' ||
    input.code === 'missing_api_key' || input.code === 'model_request_not_sent'
  const providerResponded = failure?.responseReceived === true ||
    failure?.httpStatus !== undefined || Boolean(failure?.providerCode)
  const transportFailure = failure?.category === 'network' || failure?.category === 'timeout' ||
    input.code === 'model_provider_unreachable' || input.code?.startsWith('stream_') === true
  const requestState = preflightFailure
    ? 'not_sent' as const
    : providerResponded
    ? 'provider_responded' as const
    : transportFailure
      ? 'sent_no_response' as const
      : undefined
  if (!requestState) return undefined
  return {
    requestState,
    ...(failure?.providerId || input.request.providerId
      ? { providerId: failure?.providerId ?? input.request.providerId }
      : {}),
    model: failure?.modelId ?? input.request.model,
    ...(failure?.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
    ...(failure?.providerCode || (requestState === 'provider_responded' && input.code)
      ? { providerCode: failure?.providerCode ?? input.code }
      : {}),
    ...(failure?.category ? { category: failure.category } : preflightFailure ? { category: 'authentication' } : {}),
    ...(failure?.retryAfterMs !== undefined ? { retryAfterMs: failure.retryAfterMs } : {})
  }
}

export function modelPreflightFailureContext(
  error: unknown,
  request: Pick<ModelRequest, 'providerId' | 'model'>
): { message: string; code: string; context: ModelRequestFailureContext } | null {
  const message = redactSecretText(error instanceof Error ? error.message : String(error))
  if (!PREFLIGHT_PATTERNS.some((pattern) => pattern.test(message))) return null
  return {
    message,
    code: 'model_request_not_sent',
    context: {
      requestState: 'not_sent',
      ...(request.providerId ? { providerId: request.providerId } : {}),
      model: request.model,
      category: /credential/i.test(message) ? 'authentication' : 'capability'
    }
  }
}

export async function recordModelPreflightFailure(input: {
  error: unknown
  request: Pick<ModelRequest, 'providerId' | 'model'>
  threadId: string
  turnId: string
  rememberFailure: (turnId: string, failure: TurnExecutionFailure) => void
  events: Pick<RuntimeEventRecorder, 'record'>
}): Promise<boolean> {
  const failure = modelPreflightFailureContext(input.error, input.request)
  if (!failure) return false
  input.rememberFailure(input.turnId, {
    error: failure.message,
    code: failure.code,
    modelRequestFailure: failure.context,
    severity: 'error'
  })
  await input.events.record({
    kind: 'error',
    threadId: input.threadId,
    turnId: input.turnId,
    message: failure.message,
    code: failure.code,
    modelRequestFailure: failure.context,
    severity: 'error'
  })
  return true
}
