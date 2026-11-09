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

export function sanitizeModelDiagnostic(value: string): string {
  return redactSecretText(value).replace(/\b(?:sk|pk|rk|ghp|github_pat|xox[baprs])[-_][a-z0-9_-]{12,}/gi, '<redacted>')
}

export function sanitizeModelFailure(failure: ModelFailureMetadata | undefined): ModelFailureMetadata | undefined {
  if (!failure) return undefined
  const { firstStreamFailure, ...rest } = failure
  return {
    ...rest,
    ...(failure.providerCode ? { providerCode: sanitizeModelDiagnostic(failure.providerCode) } : {}),
    ...(failure.providerId ? { providerId: sanitizeModelDiagnostic(failure.providerId) } : {}),
    ...(failure.modelId ? { modelId: sanitizeModelDiagnostic(failure.modelId) } : {}),
    ...(firstStreamFailure && typeof firstStreamFailure.code === 'string' && typeof firstStreamFailure.message === 'string'
      ? { firstStreamFailure: {
          code: sanitizeModelDiagnostic(firstStreamFailure.code).slice(0, 128),
          message: sanitizeModelDiagnostic(firstStreamFailure.message).slice(0, 1024)
        } }
      : {})
  }
}

export function modelRequestFailureContext(input: {
  request: Pick<ModelRequest, 'providerId' | 'model'>
  failure?: ModelFailureMetadata
  code?: string
}): ModelRequestFailureContext | undefined {
  const failure = input.failure
  const localNotSent = failure?.requestSent === false
  const preflightFailure = localNotSent || input.code === 'credential_refresh_failed' ||
    input.code === 'missing_api_key' || input.code === 'model_request_not_sent'
  const providerResponded = failure?.responseReceived === true || Boolean(failure?.providerCode) ||
    (failure?.httpStatus !== undefined && (failure.responsePhase !== 'interrupted' || failure.httpStatus >= 400))
  // A successful stream that later broke is neither an absent response nor a
  // provider error. Its phase is carried in the existing error details.
  if (!preflightFailure && !providerResponded && failure?.responsePhase === 'interrupted') return undefined
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
    ...(!localNotSent && failure?.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
    ...(!localNotSent && (failure?.providerCode || (requestState === 'provider_responded' && input.code))
      ? { providerCode: failure?.providerCode ?? input.code }
      : {}),
    ...(failure?.category ? { category: failure.category } : preflightFailure ? { category: 'authentication' } : {}),
    ...(failure?.reason ? { reason: failure.reason } : {}),
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
